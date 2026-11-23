import { discountPercent, ratingScore, valueScore, verdictFor, type TrackedPrice } from "./pricing.ts";
import { CURRENCIES, DEFAULT_REGION, REGIONS, currencyForCountry, findRegion } from "./regions.ts";
import { fetchOwned, fetchWishlist, resolveProfile, searchStore } from "./steam.ts";

// Prices change at most every few hours, so the edge keeps responses for 30 minutes while browsers recheck after 5.
const CACHE_SECONDS = 1800;
const BROWSER_CACHE_SECONDS = 300;
const LIST_TAGS = 6;
const DEFAULT_CAPSULE = "library_600x900.jpg";
const DEFAULT_HEADER = "header.jpg";

const META_BROWSER_SECONDS = 300;

function json(body: unknown, status = 200, cacheSeconds = 0, scope: "public" | "private" = "public"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": !cacheSeconds ? "no-store"
        : scope === "private" ? `private, max-age=${cacheSeconds}`
        : `public, max-age=${Math.min(cacheSeconds, BROWSER_CACHE_SECONDS)}, s-maxage=${cacheSeconds}`,
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
  if (url.pathname === "/api/status") return status(env);
  if (url.pathname === "/api/profile" || url.pathname === "/api/search") {
    // These two call Steam on every uncached request, so each visitor gets a small budget.
    const { success } = await env.LOOKUP_LIMITER.limit({ key: request.headers.get("CF-Connecting-IP") ?? "unknown" });
    if (!success) return json({ error: "Too many lookups. Wait a minute and try again." }, 429);
    if (url.pathname === "/api/profile") return profile(env, url);
    return cached(request, ctx, () => search(url));
  }
  if (url.pathname === "/api/games") return cached(request, ctx, () => listGames(env, url));
  const game = url.pathname.match(/^\/api\/games\/(\d+)$/);
  if (game) return cached(request, ctx, () => gameDetail(env, Number(game[1]), url));
  return json({ error: "Not found" }, 404);
}

type RateRow = { currency: string; per_usd: number; updated_at: string };
const RATES_MEMORY_MS = 10 * 60_000;
let ratesInMemory: { at: number; rows: RateRow[] } | null = null;

// Rates change once a day, so each Worker instance keeps them in memory instead of asking D1 on every page load.
async function loadRates(env: Env): Promise<RateRow[]> {
  if (ratesInMemory && Date.now() - ratesInMemory.at < RATES_MEMORY_MS) return ratesInMemory.rows;
  const { results } = await env.DB.prepare("SELECT currency, per_usd, updated_at FROM rates").all<RateRow>();
  if (results.length) ratesInMemory = { at: Date.now(), rows: results };
  return results;
}

async function meta(request: Request, env: Env): Promise<Response> {
  const country = (request.cf?.country as string | undefined) ?? null;
  const rates = await loadRates(env);
  const perUsd = new Map(rates.map(r => [r.currency, r.per_usd]));
  return json({
    country,
    defaultRegion: DEFAULT_REGION,
    defaultCurrency: currencyForCountry(country ?? undefined),
    regions: REGIONS.map(({ code, name, currency }) => ({ code, name, currency })),
    currencies: CURRENCIES.filter(c => perUsd.has(c.code)).map(c => ({ ...c, perUsd: perUsd.get(c.code) })),
    ratesUpdatedAt: rates[0]?.updated_at ?? null,
  }, 200, META_BROWSER_SECONDS, "private");
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
  is_free: number;
  currency: string | null;
  regular: number | null;
  current: number | null;
  lowest: number | null;
  tracked_since: string | null;
  capsule_path: string | null;
  header_path: string | null;
}

async function listGames(env: Env, url: URL): Promise<Response> {
  const region = findRegion(url.searchParams.get("region"));
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.name, g.developer, g.released, g.tags, g.coop, g.deck, g.capsule_path, g.header_path,
            g.positive, g.negative, g.median_minutes, g.is_free,
            p.currency, p.regular, p.current, p.lowest, p.tracked_since
     FROM games g LEFT JOIN prices p ON p.game_id = g.id AND p.region = ?
     WHERE g.listed = 1 AND (p.game_id IS NOT NULL OR g.is_free = 1)
     ORDER BY g.rank`,
  ).bind(region.code).all<GameRow>();

  const now = new Date();
  const games = results.map(g => {
    const free = g.is_free === 1 && g.current === null;
    const price = free
      ? { regular: 0, current: 0, lowest: 0, trackedSince: null }
      : { regular: g.regular!, current: g.current!, lowest: g.lowest!, trackedSince: g.tracked_since! };
    const verdict = free ? "free" : verdictFor(price as TrackedPrice, now);
    const discount = discountPercent(price);
    const rating = ratingScore(g.positive, g.negative);
    const reviews = g.positive + g.negative;
    return {
      id: g.id,
      name: g.name,
      developer: g.developer,
      released: g.released,
      tags: (JSON.parse(g.tags) as string[]).slice(0, LIST_TAGS),
      ...imagePaths(g),
      coop: g.coop === 1,
      deck: g.deck,
      reviews,
      positivePct: reviews ? Math.round((g.positive / reviews) * 100) : null,
      medianHours: Math.round(g.median_minutes / 60),
      ...price,
      free,
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
  const [game, price, changes, regions] = await env.DB.batch([
    env.DB.prepare("SELECT description, tags, is_free FROM games WHERE id = ?").bind(id),
    env.DB.prepare("SELECT currency, regular, current, lowest, first_price, tracked_since FROM prices WHERE game_id = ? AND region = ?").bind(id, region.code),
    env.DB.prepare("SELECT changed_at, price FROM price_changes WHERE game_id = ? AND region = ? ORDER BY changed_at").bind(id, region.code),
    env.DB.prepare("SELECT region, currency, regular, current FROM prices WHERE game_id = ?").bind(id),
  ]);
  const row = price.results[0] as { currency: string; regular: number; current: number; lowest: number; first_price: number; tracked_since: string } | undefined;
  const info = game.results[0] as { description: string | null; tags: string; is_free: number } | undefined;
  if (!row && info?.is_free === 1) {
    return json({ description: info.description, tags: JSON.parse(info.tags), region: region.code, free: true, regions: [], changes: [] }, 200, CACHE_SECONDS);
  }
  if (!row) return json({ error: "No price for this game in this region" }, 404);
  return json({
    description: info?.description ?? null,
    tags: info ? JSON.parse(info.tags) : [],
    region: region.code,
    currency: row.currency,
    regular: row.regular,
    current: row.current,
    lowest: row.lowest,
    trackedSince: row.tracked_since,
    regions: regions.results as { region: string; currency: string; regular: number; current: number }[],
    changes: [
      { at: row.tracked_since, price: row.first_price },
      ...(changes.results as { changed_at: string; price: number }[]).map(c => ({ at: c.changed_at, price: c.price })),
    ],
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

async function search(url: URL): Promise<Response> {
  const term = url.searchParams.get("q")?.trim() ?? "";
  if (term.length < 2) return json({ results: [] });
  const region = findRegion(url.searchParams.get("region"));
  const results = await searchStore(term, region.steamCountry).catch(() => []);
  return json({ results }, 200, CACHE_SECONDS);
}

// Only paths that differ from Steam's default file names are sent, to keep the list small.
function imagePaths(g: GameRow): { capsule?: string; header?: string } {
  const paths: { capsule?: string; header?: string } = {};
  if (g.capsule_path !== null && g.capsule_path !== DEFAULT_CAPSULE) paths.capsule = g.capsule_path;
  if (g.header_path !== null && g.header_path !== DEFAULT_HEADER) paths.header = g.header_path;
  return paths;
}

async function status(env: Env): Promise<Response> {
  const [counts, regions, state] = await env.DB.batch([
    env.DB.prepare(
      `SELECT count(*) AS games, sum(listed) AS listed,
              sum(listed = 1 AND details_synced_at IS NOT NULL) AS with_details,
              sum(listed = 1 AND capsule_path IS NOT NULL) AS with_images,
              (SELECT count(*) FROM price_changes) AS price_changes,
              (SELECT max(updated_at) FROM rates) AS rates_at
       FROM games`,
    ),
    env.DB.prepare("SELECT region, count(*) AS games, max(updated_at) AS last_change FROM prices GROUP BY region"),
    env.DB.prepare("SELECT key, value FROM sync_state"),
  ]);
  const c = counts.results[0] as Record<string, number | string | null>;
  const s = Object.fromEntries((state.results as { key: string; value: string }[]).map(r => [r.key, r.value]));
  const byRegion = new Map((regions.results as { region: string; games: number; last_change: string }[]).map(r => [r.region, r]));
  return json({
    lastRun: s.last_run ? JSON.parse(s.last_run) : null,
    catalogue: {
      games: c.games,
      listed: c.listed ?? 0,
      withDetails: c.with_details ?? 0,
      withImages: c.with_images ?? 0,
      nextSourcePage: Number(s.catalogue_source_page ?? 0),
      lastFullRefresh: s.catalogue_round_at ?? null,
    },
    prices: {
      cursor: s.prices_cursor ? JSON.parse(s.prices_cursor) : null,
      changesRecorded: c.price_changes,
      regions: REGIONS.map(r => ({
        region: r.code,
        games: byRegion.get(r.code)?.games ?? 0,
        lastChange: byRegion.get(r.code)?.last_change ?? null,
      })),
    },
    ratesUpdatedAt: c.rates_at,
  });
}
