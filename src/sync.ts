import { CURRENCIES, REGIONS, type Region } from "./regions.ts";
import { fetchAppDetails, fetchDeckCategory, fetchImagePaths, fetchPrices, fetchSteamSpyDetails, fetchTopGames, fetchTopSellers, fetchUsdRates, TOP_SELLERS_PAGE_SIZE, type RegionalPrice } from "./steam.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const PRICE_BATCH = 150;
// Keeps each run under the free plan's 50 outbound requests: 1 rates call, 1 catalogue page, 15 price chunks, 1 image lookup, 3 per game.
const TOP_SELLER_PAGES = 5;
const CATALOGUE_PAGES = 5;
const CATALOGUE_PAGE_SIZE = 1000;
const PRICE_REQUESTS_PER_RUN = 15;
const DETAILS_PER_RUN = 10;
const IMAGE_LOOKUPS_PER_RUN = 100;
const DETAILS_MAX_AGE_MS = 7 * DAY_MS;
const DETAILS_RETRY_MS = DAY_MS;
const STEAMSPY_GAP_MS = 1100;

type Task = (db: D1Database, now: Date) => Promise<void>;

export async function runSync(env: Env, now = new Date()): Promise<void> {
  const tasks: Task[] = [syncRates, syncCatalogue, syncPrices, syncImagePaths, syncDetails];
  const failed: string[] = [];
  for (const task of tasks) {
    try {
      await task(env.DB, now);
    } catch (err) {
      failed.push(task.name);
      console.error(`${task.name} failed`, err);
    }
  }
  await setState(env.DB, "last_run", JSON.stringify({ at: now.toISOString(), failed })).catch(() => {});
}

async function getState(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM sync_state WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function setState(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare("INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value).run();
}

function isDue(lastRun: string | null, now: Date, everyMs: number): boolean {
  return !lastRun || now.getTime() - Date.parse(lastRun) >= everyMs;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function syncRates(db: D1Database, now: Date): Promise<void> {
  if (!isDue(await getState(db, "rates_at"), now, DAY_MS)) return;
  const rates = await fetchUsdRates();
  const wanted = Object.fromEntries(CURRENCIES.filter(c => rates[c.code]).map(c => [c.code, rates[c.code]]));
  await db.prepare(
    `INSERT INTO rates (currency, per_usd, updated_at)
     SELECT key, value, ?1 FROM json_each(?2) WHERE true
     ON CONFLICT(currency) DO UPDATE SET per_usd = excluded.per_usd, updated_at = excluded.updated_at`,
  ).bind(now.toISOString(), JSON.stringify(wanted)).run();
  await setState(db, "rates_at", now.toISOString());
}

// The catalogue combines Steam's current top sellers, which catch new releases quickly,
// with SteamSpy's all-time most owned games. One page is read per run.
async function syncCatalogue(db: D1Database, now: Date): Promise<void> {
  const page = Number(await getState(db, "catalogue_source_page")) || 0;
  if (page === 0 && !isDue(await getState(db, "catalogue_round_at"), now, DAY_MS)) return;

  if (page < TOP_SELLER_PAGES) {
    const sellers = (await fetchTopSellers(page)).map((g, i) => ({ ...g, rank: page * TOP_SELLERS_PAGE_SIZE + i }));
    await db.prepare(
      `INSERT INTO games (id, name, rank)
       SELECT json_extract(value, '$.id'), json_extract(value, '$.name'), json_extract(value, '$.rank')
       FROM json_each(?1) WHERE true
       ON CONFLICT(id) DO UPDATE SET rank = excluded.rank WHERE games.rank IS NOT excluded.rank`,
    ).bind(JSON.stringify(sellers)).run();
  } else {
    const spyPage = page - TOP_SELLER_PAGES;
    const firstRank = TOP_SELLER_PAGES * TOP_SELLERS_PAGE_SIZE + spyPage * CATALOGUE_PAGE_SIZE;
    const games = (await fetchTopGames(spyPage))
      .map((g, i) => ({ ...g, rank: firstRank + i, isFree: g.isFree ? 1 : 0 }));
    // One statement for the whole page keeps us inside D1's per-invocation query limit.
    await db.prepare(
      `INSERT INTO games (id, name, rank, positive, negative, median_minutes, is_free)
       SELECT json_extract(value, '$.id'), json_extract(value, '$.name'), json_extract(value, '$.rank'),
              json_extract(value, '$.positive'), json_extract(value, '$.negative'), json_extract(value, '$.medianMinutes'),
              json_extract(value, '$.isFree')
       FROM json_each(?1) WHERE true
       ON CONFLICT(id) DO UPDATE SET rank = MIN(games.rank, excluded.rank), positive = excluded.positive,
         negative = excluded.negative, median_minutes = excluded.median_minutes
       WHERE games.positive IS NOT excluded.positive OR games.negative IS NOT excluded.negative
         OR games.median_minutes IS NOT excluded.median_minutes OR games.rank > excluded.rank`,
    ).bind(JSON.stringify(games)).run();
  }

  const next = page + 1;
  if (next < TOP_SELLER_PAGES + CATALOGUE_PAGES) {
    await setState(db, "catalogue_source_page", String(next));
  } else {
    await setState(db, "catalogue_source_page", "0");
    await setState(db, "catalogue_round_at", now.toISOString());
  }
}

interface PriceCursor {
  region: number;
  offset: number;
}

// Prices are fetched in chunks of 150 games and resume where the previous run stopped,
// so a catalogue too big for one run still cycles through every region.
async function syncPrices(db: D1Database, now: Date): Promise<void> {
  const saved = await getState(db, "prices_cursor");
  let cursor: PriceCursor = saved ? JSON.parse(saved) : { region: 0, offset: 0 };
  const { results } = await db.prepare("SELECT id FROM games WHERE listed = 1 AND is_free = 0 ORDER BY rank").all<{ id: number }>();
  const ids = results.map(r => r.id);
  if (!ids.length) return;

  let requests = PRICE_REQUESTS_PER_RUN;
  while (requests > 0) {
    const region = REGIONS[cursor.region % REGIONS.length];
    const fetched: RegionalPrice[] = [];
    while (requests > 0 && cursor.offset < ids.length) {
      const chunk = ids.slice(cursor.offset, cursor.offset + PRICE_BATCH);
      try {
        fetched.push(...await fetchPrices(chunk, region.steamCountry));
      } catch (err) {
        console.error(`prices for ${region.code} at ${cursor.offset} failed`, err);
      }
      cursor.offset += PRICE_BATCH;
      requests--;
    }
    if (cursor.offset >= ids.length) cursor = { region: (cursor.region + 1) % REGIONS.length, offset: 0 };
    await savePrices(db, region, fetched, now);
    await setState(db, "prices_cursor", JSON.stringify(cursor));
  }
}

async function savePrices(db: D1Database, region: Region, fetched: RegionalPrice[], now: Date): Promise<void> {
  if (!fetched.length) return;
  const { results: existing } = await db.prepare(
    "SELECT game_id, regular, current FROM prices WHERE region = ? AND game_id IN (SELECT value FROM json_each(?))",
  ).bind(region.code, JSON.stringify(fetched.map(p => p.id))).all<{ game_id: number; regular: number; current: number }>();
  const known = new Map(existing.map(p => [p.game_id, p]));
  const updated = fetched.filter(p => {
    const old = known.get(p.id);
    return old && (old.current !== p.current || old.regular !== p.regular);
  });
  const changed = [...fetched.filter(p => !known.has(p.id)), ...updated];
  if (!changed.length) return;

  const stamp = now.toISOString();
  const statements = [
    db.prepare(
      `INSERT INTO prices (game_id, region, currency, regular, current, lowest, first_price, tracked_since, updated_at)
       SELECT json_extract(value, '$.id'), ?1, json_extract(value, '$.currency'), json_extract(value, '$.regular'),
              json_extract(value, '$.current'), json_extract(value, '$.current'), json_extract(value, '$.current'), ?2, ?2
       FROM json_each(?3) WHERE true
       ON CONFLICT(game_id, region) DO UPDATE SET currency = excluded.currency, regular = excluded.regular,
         current = excluded.current, lowest = MIN(prices.lowest, excluded.current), updated_at = excluded.updated_at`,
    ).bind(region.code, stamp, JSON.stringify(changed)),
  ];
  if (updated.length) {
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO price_changes (game_id, region, changed_at, price)
       SELECT json_extract(value, '$.id'), ?1, ?2, json_extract(value, '$.current') FROM json_each(?3)`,
    ).bind(region.code, stamp, JSON.stringify(updated)));
  }
  await db.batch(statements);
}

async function syncDetails(db: D1Database, now: Date): Promise<void> {
  const staleBefore = new Date(now.getTime() - DETAILS_MAX_AGE_MS).toISOString();
  const { results: due } = await db.prepare(
    `SELECT id FROM games WHERE details_synced_at IS NULL OR details_synced_at < ?
     ORDER BY details_synced_at IS NOT NULL, rank LIMIT ?`,
  ).bind(staleBefore, DETAILS_PER_RUN).all<{ id: number }>();

  const updates: D1PreparedStatement[] = [];
  for (const { id } of due) {
    try {
      const details = await fetchAppDetails(id);
      if (!details) {
        updates.push(db.prepare("UPDATE games SET listed = 0, details_synced_at = ? WHERE id = ?").bind(now.toISOString(), id));
        continue;
      }
      await sleep(STEAMSPY_GAP_MS);
      const [spy, deck] = await Promise.all([fetchSteamSpyDetails(id), fetchDeckCategory(id)]);
      updates.push(db.prepare(
        `UPDATE games SET name = ?, developer = ?, description = ?, released = ?, tags = ?, coop = ?, deck = ?,
           positive = MAX(positive, ?), negative = MAX(negative, ?), median_minutes = MAX(median_minutes, ?),
           is_free = ?, listed = 1, details_synced_at = ? WHERE id = ?`,
      ).bind(details.name, details.developer, details.description, details.released, JSON.stringify(spy.tags),
        details.coop ? 1 : 0, deck, spy.positive, spy.negative, spy.medianMinutes, details.isFree ? 1 : 0, now.toISOString(), id));
    } catch (err) {
      console.error(`details for ${id} failed`, err);
      // Push a failing game back in the queue so it cannot block the others, and keep it hidden until it has details.
      const retryAt = new Date(now.getTime() - DETAILS_MAX_AGE_MS + DETAILS_RETRY_MS).toISOString();
      updates.push(db.prepare(
        "UPDATE games SET listed = CASE WHEN details_synced_at IS NULL THEN 0 ELSE listed END, details_synced_at = ? WHERE id = ?",
      ).bind(retryAt, id));
    }
  }
  if (updates.length) await db.batch(updates);
}

async function syncImagePaths(db: D1Database): Promise<void> {
  const { results } = await db.prepare("SELECT id FROM games WHERE listed = 1 AND capsule_path IS NULL ORDER BY rank LIMIT ?")
    .bind(IMAGE_LOOKUPS_PER_RUN).all<{ id: number }>();
  if (!results.length) return;
  const paths = await fetchImagePaths(results.map(r => r.id));
  await db.prepare(
    `UPDATE games SET capsule_path = json_extract(j.value, '$.capsule'), header_path = json_extract(j.value, '$.header')
     FROM json_each(?) AS j WHERE games.id = json_extract(j.value, '$.id')`,
  ).bind(JSON.stringify(paths)).run();
}
