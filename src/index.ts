import { handleApi } from "./api.ts";
import { shareMeta, withShareMeta } from "./share.ts";
import { runSync } from "./sync.ts";

async function homePage(request: Request, env: Env): Promise<Response> {
  const page = await env.ASSETS.fetch(request);
  const id = Number(new URL(request.url).searchParams.get("game"));
  if (!page.ok || !Number.isInteger(id) || id <= 0) return page;

  const game = await env.DB.prepare(
    `SELECT g.id, g.name, g.header_path, g.positive, g.negative, g.is_free,
            p.currency, p.regular, p.current, p.lowest, p.tracked_since
     FROM games g LEFT JOIN prices p ON p.game_id = g.id AND p.region = 'US'
     WHERE g.id = ? AND g.listed = 1`,
  ).bind(id).first<{
    id: number; name: string; header_path: string | null; positive: number; negative: number; is_free: number;
    currency: string | null; regular: number | null; current: number | null; lowest: number | null; tracked_since: string | null;
  }>();
  if (!game) return page;

  const price = game.currency && game.regular !== null && game.current !== null && game.lowest !== null && game.tracked_since
    ? { currency: game.currency, regular: game.regular, current: game.current, lowest: game.lowest, trackedSince: game.tracked_since }
    : null;
  return withShareMeta(page, shareMeta(
    { id: game.id, name: game.name, headerPath: game.header_path, positive: game.positive, negative: game.negative, free: game.is_free === 1, price },
    new Date(),
  ));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, ctx);
    if (url.pathname === "/") return homePage(request, env);
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runSync(env));
  },
} satisfies ExportedHandler<Env>;
