import { CURRENCIES, REGIONS } from "./regions.ts";
import { fetchAppDetails, fetchDeckCategory, fetchPrices, fetchTags, fetchTopGames, fetchUsdRates, type RegionalPrice } from "./steam.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const PRICE_BATCH = 150;
const DETAILS_PER_RUN = 8;
const DETAILS_MAX_AGE_MS = 7 * DAY_MS;
const STEAMSPY_GAP_MS = 1100;

type Task = (db: D1Database, now: Date) => Promise<void>;

export async function runSync(env: Env, now = new Date()): Promise<void> {
  const tasks: Task[] = [syncRates, syncCatalogue, syncPrices, syncDetails];
  for (const task of tasks) {
    try {
      await task(env.DB, now);
    } catch (err) {
      console.error(`${task.name} failed`, err);
    }
  }
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

async function syncCatalogue(db: D1Database, now: Date): Promise<void> {
  if (!isDue(await getState(db, "catalogue_at"), now, DAY_MS)) return;
  const games = (await fetchTopGames()).filter(g => !g.isFree).map((g, rank) => ({ ...g, rank }));
  // One statement for the whole list keeps us inside D1's per-invocation query limit.
  await db.prepare(
    `INSERT INTO games (id, name, rank, positive, negative, median_minutes)
     SELECT json_extract(value, '$.id'), json_extract(value, '$.name'), json_extract(value, '$.rank'),
            json_extract(value, '$.positive'), json_extract(value, '$.negative'), json_extract(value, '$.medianMinutes')
     FROM json_each(?1) WHERE true
     ON CONFLICT(id) DO UPDATE SET rank = excluded.rank, positive = excluded.positive,
       negative = excluded.negative, median_minutes = excluded.median_minutes`,
  ).bind(JSON.stringify(games)).run();
  await setState(db, "catalogue_at", now.toISOString());
}

async function syncPrices(db: D1Database, now: Date): Promise<void> {
  const index = (Number(await getState(db, "prices_region")) || 0) % REGIONS.length;
  const region = REGIONS[index];
  const { results: games } = await db.prepare("SELECT id FROM games WHERE listed = 1 AND is_free = 0 ORDER BY rank").all<{ id: number }>();

  const fetched: RegionalPrice[] = [];
  for (let i = 0; i < games.length; i += PRICE_BATCH) {
    fetched.push(...await fetchPrices(games.slice(i, i + PRICE_BATCH).map(g => g.id), region.steamCountry));
  }

  const { results: existing } = await db.prepare("SELECT game_id, regular, current FROM prices WHERE region = ?")
    .bind(region.code).all<{ game_id: number; regular: number; current: number }>();
  const known = new Map(existing.map(p => [p.game_id, p]));
  const changed = fetched.filter(p => {
    const old = known.get(p.id);
    return !old || old.current !== p.current || old.regular !== p.regular;
  });

  if (changed.length) {
    const stamp = now.toISOString();
    const payload = JSON.stringify(changed);
    await db.batch([
      db.prepare(
        `INSERT INTO prices (game_id, region, currency, regular, current, lowest, tracked_since, updated_at)
         SELECT json_extract(value, '$.id'), ?1, json_extract(value, '$.currency'), json_extract(value, '$.regular'),
                json_extract(value, '$.current'), json_extract(value, '$.current'), ?2, ?2
         FROM json_each(?3) WHERE true
         ON CONFLICT(game_id, region) DO UPDATE SET currency = excluded.currency, regular = excluded.regular,
           current = excluded.current, lowest = MIN(prices.lowest, excluded.current), updated_at = excluded.updated_at`,
      ).bind(region.code, stamp, payload),
      db.prepare(
        `INSERT OR IGNORE INTO price_changes (game_id, region, changed_at, price)
         SELECT json_extract(value, '$.id'), ?1, ?2, json_extract(value, '$.current') FROM json_each(?3)`,
      ).bind(region.code, stamp, payload),
    ]);
  }
  await setState(db, "prices_region", String(index + 1));
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
      if (!details || details.isFree) {
        updates.push(db.prepare("UPDATE games SET listed = 0, details_synced_at = ? WHERE id = ?").bind(now.toISOString(), id));
        continue;
      }
      await sleep(STEAMSPY_GAP_MS);
      const [tags, deck] = await Promise.all([fetchTags(id), fetchDeckCategory(id)]);
      updates.push(db.prepare(
        `UPDATE games SET name = ?, developer = ?, description = ?, released = ?, tags = ?, coop = ?, deck = ?,
           listed = 1, details_synced_at = ? WHERE id = ?`,
      ).bind(details.name, details.developer, details.description, details.released, JSON.stringify(tags),
        details.coop ? 1 : 0, deck, now.toISOString(), id));
    } catch (err) {
      console.error(`details for ${id} failed`, err);
    }
  }
  if (updates.length) await db.batch(updates);
}
