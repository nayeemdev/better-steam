const HEADERS = { "User-Agent": "better-steam/1.0", Accept: "application/json" };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json() as Promise<T>;
}

export interface CatalogueEntry {
  id: number;
  name: string;
  positive: number;
  negative: number;
  medianMinutes: number;
  isFree: boolean;
}

interface SteamSpyApp {
  appid: number;
  name: string;
  positive: number;
  negative: number;
  median_forever: number;
  initialprice: string;
}

export async function fetchTopGames(page: number): Promise<CatalogueEntry[]> {
  const data = await getJson<Record<string, SteamSpyApp>>(`https://steamspy.com/api.php?request=all&page=${page}`);
  return Object.values(data).map(a => ({
    id: a.appid,
    name: a.name,
    positive: a.positive,
    negative: a.negative,
    medianMinutes: a.median_forever,
    isFree: Number(a.initialprice) === 0,
  }));
}

export interface SteamSpyDetails {
  tags: string[];
  positive: number;
  negative: number;
  medianMinutes: number;
}

export async function fetchSteamSpyDetails(id: number): Promise<SteamSpyDetails> {
  const data = await getJson<{ tags?: Record<string, number> | unknown[]; positive?: number; negative?: number; median_forever?: number }>(
    `https://steamspy.com/api.php?request=appdetails&appid=${id}`,
  );
  const tags = data.tags && !Array.isArray(data.tags)
    ? Object.entries(data.tags).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tag]) => tag)
    : [];
  return { tags, positive: data.positive ?? 0, negative: data.negative ?? 0, medianMinutes: data.median_forever ?? 0 };
}

export const TOP_SELLERS_PAGE_SIZE = 100;

export async function fetchTopSellers(page: number): Promise<{ id: number; name: string }[]> {
  const data = await getJson<{ items?: { name: string; logo: string }[] }>(
    `https://store.steampowered.com/search/results/?json=1&filter=topsellers&cc=us&count=${TOP_SELLERS_PAGE_SIZE}&start=${page * TOP_SELLERS_PAGE_SIZE}`,
  );
  return (data.items ?? []).flatMap(item => {
    const id = Number(item.logo.match(/\/apps\/(\d+)\//)?.[1]);
    return id ? [{ id, name: item.name }] : [];
  });
}

export interface StoreSearchResult {
  id: number;
  name: string;
  image: string;
  price: { currency: string; regular: number; current: number } | null;
}

export async function searchStore(term: string, steamCountry: string): Promise<StoreSearchResult[]> {
  const data = await getJson<{ items?: { id: number; type: string; name: string; tiny_image: string; price?: { currency: string; initial: number; final: number } }[] }>(
    `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&cc=${steamCountry}&l=english`,
  );
  return (data.items ?? []).filter(i => i.type === "app").map(i => ({
    id: i.id,
    name: i.name,
    image: i.tiny_image,
    price: i.price ? { currency: i.price.currency, regular: i.price.initial, current: i.price.final } : null,
  }));
}

export interface AppDetails {
  name: string;
  developer: string | null;
  description: string;
  released: string | null;
  coop: boolean;
  isFree: boolean;
}

const COOP_CATEGORIES = new Set([9, 38, 39, 48]);

interface SteamAppDetails {
  name: string;
  type: string;
  is_free: boolean;
  short_description: string;
  developers?: string[];
  release_date?: { date: string };
  categories?: { id: number }[];
}

export async function fetchAppDetails(id: number): Promise<AppDetails | null> {
  const data = await getJson<Record<string, { success: boolean; data?: SteamAppDetails }>>(
    `https://store.steampowered.com/api/appdetails?appids=${id}&cc=us&l=english`,
  );
  const app = data[id]?.success ? data[id].data : undefined;
  if (!app || app.type !== "game") return null;
  return {
    name: app.name,
    developer: app.developers?.[0] ?? null,
    description: decodeEntities(app.short_description),
    released: app.release_date?.date || null,
    coop: (app.categories ?? []).some(c => COOP_CATEGORIES.has(c.id)),
    isFree: app.is_free,
  };
}

export const DECK_UNKNOWN = 0;

export async function fetchDeckCategory(id: number): Promise<number> {
  const data = await getJson<{ results?: { resolved_category?: number } }>(
    `https://store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport?nAppID=${id}`,
  );
  return data.results?.resolved_category ?? DECK_UNKNOWN;
}

export interface RegionalPrice {
  id: number;
  currency: string;
  regular: number;
  current: number;
}

export async function fetchPrices(ids: number[], steamCountry: string): Promise<RegionalPrice[]> {
  const data = await getJson<Record<string, { success: boolean; data?: { price_overview?: { currency: string; initial: number; final: number } } | [] }>>(
    `https://store.steampowered.com/api/appdetails?appids=${ids.join(",")}&cc=${steamCountry}&filters=price_overview`,
  );
  const prices: RegionalPrice[] = [];
  for (const [id, entry] of Object.entries(data)) {
    const overview = entry.success && !Array.isArray(entry.data) ? entry.data?.price_overview : undefined;
    if (overview) prices.push({ id: Number(id), currency: overview.currency, regular: overview.initial, current: overview.final });
  }
  return prices;
}

export async function fetchUsdRates(): Promise<Record<string, number>> {
  const data = await getJson<{ result: string; rates: Record<string, number> }>("https://open.er-api.com/v6/latest/USD");
  if (data.result !== "success") throw new Error("Exchange rate lookup failed");
  return data.rates;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export interface SteamProfile {
  steamId: string;
  name: string | null;
}

const STEAM_ID = /^\d{17}$/;

export function profilePath(input: string): string | null {
  const value = input.trim();
  const byId = value.match(/profiles\/(\d{17})/)?.[1] ?? (STEAM_ID.test(value) ? value : null);
  if (byId) return `profiles/${byId}`;
  const vanity = value.match(/\/id\/([^/?#]+)/)?.[1] ?? (/^[\w-]{2,32}$/.test(value) ? value : null);
  return vanity ? `id/${encodeURIComponent(vanity)}` : null;
}

export async function resolveProfile(input: string): Promise<SteamProfile | null> {
  const path = profilePath(input);
  if (!path) return null;
  const res = await fetch(`https://steamcommunity.com/${path}/?xml=1`, { headers: { "User-Agent": HEADERS["User-Agent"] } });
  if (!res.ok) return null;
  const xml = await res.text();
  const steamId = xml.match(/<steamID64>(\d{17})<\/steamID64>/)?.[1];
  if (!steamId) return null;
  const name = xml.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/)?.[1] ?? null;
  return { steamId, name };
}

export async function fetchWishlist(steamId: string): Promise<number[]> {
  const data = await getJson<{ response?: { items?: { appid: number }[] } }>(
    `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=${steamId}`,
  );
  return (data.response?.items ?? []).map(i => i.appid);
}

export async function fetchOwned(steamId: string, apiKey: string): Promise<number[]> {
  const data = await getJson<{ response?: { games?: { appid: number }[] } }>(
    `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}`,
  );
  return (data.response?.games ?? []).map(g => g.appid);
}

export interface ImagePaths {
  id: number;
  capsule: string;
  header: string;
}

export async function fetchImagePaths(ids: number[]): Promise<ImagePaths[]> {
  const input = {
    ids: ids.map(appid => ({ appid })),
    context: { language: "english", country_code: "US" },
    data_request: { include_assets: true },
  };
  const data = await getJson<{ response?: { store_items?: { appid?: number; id?: number; assets?: { library_capsule?: string; header?: string } }[] } }>(
    `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`,
  );
  const found = new Map((data.response?.store_items ?? []).map(item => [item.appid ?? item.id, item.assets]));
  return ids.map(id => ({ id, capsule: found.get(id)?.library_capsule ?? "", header: found.get(id)?.header ?? "" }));
}
