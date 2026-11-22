import { discountPercent, ratingScore, valueScore, verdictFor } from "./pricing.ts";
import { CURRENCIES, DEFAULT_REGION, REGIONS, currencyForCountry, findRegion } from "./regions.ts";
import { fetchOwned, fetchWishlist, resolveProfile } from "./steam.ts";

const CACHE_SECONDS = 600;
const LIST_TAGS = 6;

function json(body: unknown, status = 200, cacheSeconds = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheSeconds ? `public, max-age=${cacheSeconds}` : "no-store",
    },
  });
}

async function cached(request: Request, ctx: ExecutionContext, build: () => Promise<Response>): Promise<Response> {
  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await build();
  if (res.ok) ctx.waitUntil(cache.put(request, res.clone()));
  return res;
}

export async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const url = new URL(request.url);

  if (url.pathname === "/api/meta") return meta(request, env);
  if (url.pathname === "/api/profile") return profile(env, url);
  if (url.pathname === "/api/games") return cached(request, ctx, () => listGames(env, url));
  const game = url.pathname.match(/^\/api\/games\/(\d+)$/);
  if (game) return cached(request, ctx, () => gameDetail(env, Number(game[1]), url));
  return json({ error: "Not found" }, 404);
}

async function meta(request: Request, env: Env): Promise<Response> {
  const country = (request.cf?.country as string | undefined) ?? null;
  const { results: rates } = await env.DB.prepare("SELECT currency, per_usd, updated_at FROM rates")
    .all<{ currency: string; per_usd: number; updated_at: string }>();
  const perUsd = new Map(rates.map(r => [r.currency, r.per_usd]));
  return json({
    country,
    defaultRegion: DEFAULT_REGION,
    defaultCurrency: currencyForCountry(country ?? undefined),
    regions: REGIONS.map(({ code, name, currency }) => ({ code, name, currency })),
    currencies: CURRENCIES.filter(c => perUsd.has(c.code)).map(c => ({ ...c, perUsd: perUsd.get(c.code) })),
    ratesUpdatedAt: rates[0]?.updated_at ?? null,
  });
}

interface GameRow {
  id: number;
  name: string;
  developer: string | null;
  released: string | null;
  tags: string;
  coop: number;
  deck: number;
  positive: number;
  negative: number;
  median_minutes: number;
  currency: string;
  regular: number;
  current: number;
  lowest: number;
  tracked_since: string;
}

async function listGames(env: Env, url: URL): Promise<Response> {
  const region = findRegion(url.searchParams.get("region"));
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.name, g.developer, g.released, g.tags, g.coop, g.deck,
            g.positive, g.negative, g.median_minutes,
            p.currency, p.regular, p.current, p.lowest, p.tracked_since
     FROM games g JOIN prices p ON p.game_id = g.id AND p.region = ?
     WHERE g.listed = 1
     ORDER BY g.rank`,
  ).bind(region.code).all<GameRow>();

  const now = new Date();
  const games = results.map(g => {
    const price = { regular: g.regular, current: g.current, lowest: g.lowest, trackedSince: g.tracked_since };
    const verdict = verdictFor(price, now);
    const discount = discountPercent(price);
    const rating = ratingScore(g.positive, g.negative);
    const reviews = g.positive + g.negative;
    return {
      id: g.id,
      name: g.name,
      developer: g.developer,
      released: g.released,
      tags: (JSON.parse(g.tags) as string[]).slice(0, LIST_TAGS),
      coop: g.coop === 1,
      deck: g.deck,
      reviews,
      positivePct: reviews ? Math.round((g.positive / reviews) * 100) : null,
      medianHours: Math.round(g.median_minutes / 60),
      ...price,
      verdict,
      discount,
      rating,
      value: valueScore(rating, verdict, discount),
    };
  });
  return json({ region: region.code, currency: region.currency, games }, 200, CACHE_SECONDS);
}

async function gameDetail(env: Env, id: number, url: URL): Promise<Response> {
  const region = findRegion(url.searchParams.get("region"));
  const [game, price, changes] = await env.DB.batch([
    env.DB.prepare("SELECT description, tags FROM games WHERE id = ?").bind(id),
    env.DB.prepare("SELECT currency, regular, current, lowest, tracked_since FROM prices WHERE game_id = ? AND region = ?").bind(id, region.code),
    env.DB.prepare("SELECT changed_at, price FROM price_changes WHERE game_id = ? AND region = ? ORDER BY changed_at").bind(id, region.code),
  ]);
  const row = price.results[0] as { currency: string; regular: number; current: number; lowest: number; tracked_since: string } | undefined;
  if (!row) return json({ error: "No price for this game in this region" }, 404);
  const info = game.results[0] as { description: string | null; tags: string } | undefined;
  return json({
    description: info?.description ?? null,
    tags: info ? JSON.parse(info.tags) : [],
    region: region.code,
    currency: row.currency,
    regular: row.regular,
    current: row.current,
    lowest: row.lowest,
    trackedSince: row.tracked_since,
    changes: (changes.results as { changed_at: string; price: number }[]).map(c => ({ at: c.changed_at, price: c.price })),
  }, 200, CACHE_SECONDS);
}

async function profile(env: Env, url: URL): Promise<Response> {
  const input = url.searchParams.get("id")?.trim();
  if (!input) return json({ error: "Paste a Steam profile link or ID." }, 400);
  const who = await resolveProfile(input);
  if (!who) return json({ error: "We could not find that Steam profile. Check the link and that the profile is public." }, 404);
  const [wishlist, owned] = await Promise.all([
    fetchWishlist(who.steamId).catch(() => []),
    env.STEAM_API_KEY ? fetchOwned(who.steamId, env.STEAM_API_KEY).catch(() => null) : null,
  ]);
  return json({ ...who, wishlist, owned });
}
