const PAGE_SIZE = 48;
const CHEAP_USD = 15;
const DEFAULT_SORT = "value";
const imageUrl = (id, kind) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/${kind}.jpg`;

const hasTag = (game, tags) => tags.some(tag => game.tags.includes(tag));

const MOODS = [
  { id: "deals", label: "On sale now", icon: "tag", color: "#047857", test: g => g.discount > 0 },
  { id: "cheap", label: "Cheap", icon: "coins", color: "#e11d48", test: g => g.current < cheapLimit() },
  { id: "coop", label: "Play with friends", icon: "users", color: "#7c3aed", test: g => g.coop },
  { id: "short", label: "Short and sweet", icon: "clock", color: "#0369a1", test: g => hasTag(g, ["Short"]) || (g.medianHours > 0 && g.medianHours <= 5 && !hasTag(g, ["Multiplayer", "Massively Multiplayer", "PvP"])) },
  { id: "cosy", label: "Something cosy", icon: "cup", color: "#f59e0b", test: g => hasTag(g, ["Cozy", "Relaxing", "Cute", "Wholesome", "Farming Sim", "Life Sim"]) },
  { id: "runs", label: "One more run", icon: "repeat", color: "#c2410c", test: g => hasTag(g, ["Roguelike", "Roguelite", "Rogue-like", "Rogue-lite", "Action Roguelike", "Roguelike Deckbuilder"]) },
  { id: "brainy", label: "Strategy and puzzles", icon: "grid", color: "#4f46e5", test: g => hasTag(g, ["Strategy", "Puzzle", "Turn-Based Strategy", "Turn-Based Tactics", "Logic"]) },
  { id: "story", label: "A great story", icon: "book", color: "#be185d", test: g => hasTag(g, ["Story Rich", "Narrative", "Choices Matter"]) },
];

const SORTS = [
  { id: "value", label: "Best value", fn: (a, b) => b.value - a.value },
  { id: "saving", label: "Biggest saving", fn: (a, b) => b.discount - a.discount || b.rating - a.rating },
  { id: "rating", label: "Best reviewed", fn: (a, b) => b.rating - a.rating },
  { id: "cheap", label: "Cheapest", fn: (a, b) => a.current - b.current },
  { id: "popular", label: "Most played", fn: (a, b) => b.reviews - a.reviews },
];

const DECK_VERIFIED = 3;
const DECK_LABEL = { 0: "Unknown", 1: "Unsupported", 2: "Playable", 3: "Verified" };

const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
};

function loadWatchlist() {
  const saved = store.get("bs-watch", {});
  const entries = Array.isArray(saved) ? saved.map(id => [id, { region: null, price: null }]) : Object.entries(saved);
  return new Map(entries.map(([id, w]) => [Number(id), w]));
}

const saveWatchlist = () => store.set("bs-watch", Object.fromEntries(state.watching));

const params = new URLSearchParams(location.search);
const state = {
  meta: null,
  games: [],
  region: store.get("bs-region", null),
  currency: store.get("bs-currency", null),
  query: params.get("q") ?? "",
  moods: new Set((params.get("mood") ?? "").split(",").filter(id => MOODS.some(m => m.id === id))),
  sort: SORTS.some(s => s.id === params.get("sort")) ? params.get("sort") : DEFAULT_SORT,
  deckOnly: params.get("deck") === "1",
  wishOnly: params.get("wish") === "1",
  hideOwned: store.get("bs-hide-owned", true),
  profile: null,
  watchOnly: false,
  shown: PAGE_SIZE,
  selected: Number(params.get("game")) || null,
  hidden: new Set(store.get("bs-hidden", [])),
  watching: loadWatchlist(),
};

const $ = id => document.getElementById(id);
const byId = id => state.games.find(g => g.id === id);
const overlayPreview = () => matchMedia("(max-width: 1100px)").matches;
const icon = name => `<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const compact = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n);
const shortDate = iso => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

const currencyInfo = code => state.meta?.currencies.find(c => c.code === code);
const regionCurrency = () => state.meta.regions.find(r => r.code === state.region).currency;

function money(minor, code = regionCurrency()) {
  const info = currencyInfo(code);
  const decimals = info?.decimals ?? 2;
  const value = (minor / 100).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return info ? info.symbol + value : `${value} ${code}`;
}

function converted(minor) {
  const from = currencyInfo(regionCurrency());
  const to = currencyInfo(state.currency);
  if (!from || !to || from.code === to.code) return "";
  return "≈ " + money(Math.round(minor / from.perUsd * to.perUsd), to.code);
}

function cheapLimit() {
  const info = currencyInfo(regionCurrency());
  const major = CHEAP_USD * (info?.perUsd ?? 1);
  const step = 10 ** Math.max(0, Math.floor(Math.log10(major)) - 1);
  return Math.round(major / step) * step * 100;
}

function moodLabel(mood) {
  return mood.id === "cheap" ? `Under ${money(cheapLimit()).replace(/\.00$/, "")}` : mood.label;
}

function verdictText(g) {
  const since = shortDate(g.trackedSince);
  switch (g.verdict) {
    case "buy": return { word: "Lowest price yet", icon: "tag", why: `The lowest price we have seen since we started tracking on ${since}.` };
    case "good": return { word: "Good price", icon: "check", why: `Close to the lowest we have seen, ${money(g.lowest)}.` };
    case "sale": return { word: "On sale", icon: "tag", why: `${g.discount}% off. We started tracking this game on ${since}, so we can't yet tell if this is its best price.` };
    case "wait": return { word: "Wait for a sale", icon: "clock", why: g.discount ? `A small sale. It has been ${money(g.lowest)} before.` : `Full price. It has been ${money(g.lowest)} before.` };
    case "steady": return { word: "Never discounted", icon: "check", why: "We have never seen this game on sale. Buy it whenever you want it." };
    default: return { word: "Full price", icon: "clock", why: `No discount seen since we started tracking on ${since}.` };
  }
}

function passes(g, moods) {
  if (state.watchOnly) return state.watching.has(g.id);
  if (state.hidden.has(g.id)) return false;
  if (state.deckOnly && g.deck !== DECK_VERIFIED) return false;
  if (state.wishOnly && state.profile && !state.profile.wishlist.has(g.id)) return false;
  if (state.hideOwned && isOwned(g)) return false;
  if (state.query.trim() && !searchScore(g)) return false;
  return moods.every(m => m.test(g));
}

const isOwned = g => Boolean(state.profile?.owned?.has(g.id));
const isWished = g => Boolean(state.profile?.wishlist.has(g.id));

const ROMAN = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9" };
const searchWords = text => text.toLowerCase().replace(/[®™©]/g, "").split(/[^a-z0-9]+/).filter(Boolean);

// Lets people type short names like "gta5", "cod mw4" or "fh6" as well as full titles.
function searchKey(g) {
  if (g.searchKey) return g.searchKey;
  const words = searchWords(g.name).map(w => ROMAN[w] ?? w);
  g.searchKey = {
    text: ` ${words.join(" ")} ${searchWords(g.developer ?? "").join(" ")}`,
    compact: words.join(""),
    acronym: words.map(w => (/^\d+$/.test(w) ? w : w[0])).join(""),
  };
  return g.searchKey;
}

function searchScore(g) {
  const tokens = searchWords(state.query).map(w => ROMAN[w] ?? w);
  if (!tokens.length) return 1;
  const key = searchKey(g);
  const joined = tokens.join("");
  if (key.acronym.startsWith(joined) || key.compact.startsWith(joined)) return 3;
  if (key.text.includes(` ${tokens.join(" ")}`)) return 2;
  return tokens.every(t => key.text.includes(` ${t}`) || key.acronym.includes(t) || key.compact.includes(t)) ? 1 : 0;
}

function writeUrl() {
  const next = new URLSearchParams();
  if (state.query.trim()) next.set("q", state.query.trim());
  if (state.moods.size) next.set("mood", [...state.moods].join(","));
  if (state.sort !== DEFAULT_SORT) next.set("sort", state.sort);
  if (state.deckOnly) next.set("deck", "1");
  if (state.wishOnly) next.set("wish", "1");
  if (state.selected) next.set("game", state.selected);
  const query = next.toString();
  history.replaceState(null, "", query ? `?${query}` : location.pathname);
}

function tintFrom(img) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 24;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 24, 24);
    const data = ctx.getImageData(0, 0, 24, 24).data;
    let r = 0, g = 0, b = 0, weight = 0;
    for (let i = 0; i < data.length; i += 4) {
      const max = Math.max(data[i], data[i + 1], data[i + 2]), min = Math.min(data[i], data[i + 1], data[i + 2]);
      const sat = max ? (max - min) / max : 0;
      const w = sat * sat * (max > 40 ? 1 : 0.1);
      r += data[i] * w; g += data[i + 1] * w; b += data[i + 2] * w; weight += w;
    }
    if (weight < 1) return null;
    return clampTint(r / weight, g / weight, b / weight);
  } catch {
    return null;
  }
}

function clampTint(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const scale = max ? 170 / max : 1;
  const lift = max - min < 60 ? 0.85 : 1;
  const hex = [r, g, b].map(v => Math.round(Math.min(255, v * scale * lift)).toString(16).padStart(2, "0")).join("");
  return `#${hex}`;
}

function inkOn(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.3 ? "#16142b" : "#ffffff";
}

const tints = new Map();

function renderStatic() {
  const regions = state.meta.regions.map(r => {
    const info = currencyInfo(r.currency);
    return `<option value="${r.code}">${esc(r.name)}${info ? ` (${esc(info.symbol)})` : ""}</option>`;
  }).join("");
  document.querySelectorAll(".region-select").forEach(s => (s.innerHTML = regions));
  const currencies = state.meta.currencies.map(c => `<option value="${c.code}">${c.code} ${esc(c.symbol)}</option>`).join("");
  const noRates = !state.meta.currencies.length;
  document.querySelectorAll(".currency-select").forEach(s => {
    s.innerHTML = currencies;
    (s.closest("label") ?? s).hidden = noRates;
    if (s.labels[0]) s.labels[0].hidden = noRates;
  });
  $("sort").innerHTML = SORTS.map(s => `<button data-sort="${s.id}">${s.label}</button>`).join("");
}

function renderMoods() {
  const active = MOODS.filter(m => state.moods.has(m.id));
  $("moods").parentElement.classList.toggle("has-active", active.length > 0);
  $("moods").innerHTML = MOODS.map(m => {
    const on = state.moods.has(m.id);
    const count = state.games.filter(g => passes(g, on ? active : [...active, m])).length;
    return `<button class="mood${count ? "" : " is-empty"}" data-mood="${m.id}" style="--c:${m.color};--on:${inkOn(m.color)}" aria-pressed="${on}">
      <svg class="i mark" aria-hidden="true"><use href="#i-${m.icon}"/></svg>
      <span class="top"><span class="ico">${icon(m.icon)}</span><span class="check">${icon("check")}</span></span>
      <span><span class="n num">${count}<small>${count === 1 ? "game" : "games"}</small></span><span class="mood-label">${esc(moodLabel(m))}</span></span>
    </button>`;
  }).join("");
}

function renderFeatured() {
  const el = $("featured");
  const candidates = state.games.filter(g => !state.hidden.has(g.id) && ["buy", "good", "sale"].includes(g.verdict));
  const pick = candidates.sort((a, b) => b.value - a.value)[0]
    ?? state.games.filter(g => !state.hidden.has(g.id)).sort((a, b) => b.rating - a.rating)[0];
  if (!pick) { el.hidden = true; return; }
  const eyebrow = { buy: "Lowest price yet", good: "Good price today", sale: `${pick.discount}% off right now` }[pick.verdict] ?? "Top rated";
  const alt = converted(pick.current);
  el.hidden = false;
  el.innerHTML = `<img class="fade" src="${imageUrl(pick.id, "header")}" alt="">
    <span class="eyebrow">${icon("star")} ${esc(eyebrow)}</span>
    <h2>${esc(pick.name)}</h2>
    <div class="row">
      <span class="big num">${money(pick.current)}</span>
      ${pick.discount ? `<s class="num">${money(pick.regular)}</s><span class="off">-${pick.discount}%</span>` : ""}
      ${alt ? `<span class="num">${alt}</span>` : ""}
      <button class="go" data-open="${pick.id}">See details ${icon("arrow")}</button>
    </div>`;
}

function cardHtml(g) {
  const v = verdictText(g);
  const alt = converted(g.current);
  const tint = tints.get(g.id);
  return `<article class="card"${tint ? ` style="--tint:${tint}"` : ""} data-card="${g.id}" aria-current="${state.selected === g.id}">
    <button class="open" data-open="${g.id}" aria-label="${esc(g.name)}, ${esc(v.word)}, ${money(g.current)}">
      <div class="art">
        <span class="art-fallback" aria-hidden="true">${esc(g.name)}</span>
        <img class="fade" src="${imageUrl(g.id, "library_600x900")}" alt="" loading="lazy" crossorigin="anonymous" data-tint-for="${g.id}" width="600" height="900">
        <span class="badge v-${g.verdict}">${g.verdict === "buy" ? icon("tag") : ""}${esc(v.word)}</span>
        ${g.discount ? `<span class="off-flag num">-${g.discount}%</span>` : ""}
        ${isOwned(g) ? '<span class="owned">Owned</span>' : ""}
      </div>
      <div class="title">${esc(g.name)}</div>
      <div class="tags">${esc(g.tags.slice(0, 3).join(" · "))}</div>
      <div class="price num"><span class="now">${money(g.current)}</span>${g.discount ? `<s>${money(g.regular)}</s>` : ""}</div>
      ${alt ? `<div class="alt num">${alt}</div>` : ""}
      <div class="meta num">
        ${g.positivePct !== null ? `<span>${icon("star")}${g.positivePct}%</span>` : ""}
        ${g.medianHours ? `<span>${icon("clock")}${g.medianHours} h</span>` : ""}
        ${g.deck === DECK_VERIFIED ? `<span>${icon("deck")}Deck</span>` : ""}
        ${isWished(g) ? `<span>${icon("heart")}Wishlist</span>` : ""}
      </div>
    </button>
  </article>`;
}

function render() {
  const active = MOODS.filter(m => state.moods.has(m.id));
  const chosen = SORTS.find(s => s.id === state.sort).fn;
  const sort = state.query.trim() ? (a, b) => searchScore(b) - searchScore(a) || b.reviews - a.reviews : chosen;
  const list = state.games.filter(g => passes(g, active)).sort(sort);

  $("watchBtn").setAttribute("aria-pressed", state.watchOnly);
  $("watchCount").textContent = state.watching.size;
  $("deckOnly").setAttribute("aria-pressed", state.deckOnly);
  $("wishOnly").hidden = !state.profile;
  $("wishOnly").setAttribute("aria-pressed", state.wishOnly);
  $("hideOwned").hidden = !state.profile?.owned;
  $("hideOwned").setAttribute("aria-pressed", state.hideOwned);
  document.querySelectorAll("[data-sort]").forEach(b => b.setAttribute("aria-pressed", state.sort === b.dataset.sort));
  document.querySelectorAll(".region-select").forEach(s => (s.value = state.region));
  document.querySelectorAll(".currency-select").forEach(s => (s.value = state.currency));
  renderMoods();
  renderFeatured();
  renderAlerts();

  const filters = active.map(m => moodLabel(m).toLowerCase());
  let summary = state.watchOnly
    ? `<b class="num">${list.length}</b>on your watchlist`
    : `<b class="num">${list.length}</b>${list.length === 1 ? "game" : "games"}${filters.length ? " for " + esc(filters.join(" + ")) : ""}`;
  if (!state.watchOnly && (active.length || state.query || state.deckOnly || state.wishOnly)) summary += ` · <button class="linkish" id="clearFilters">Clear filters</button>`;
  if (!state.watchOnly && state.hidden.size) summary += ` · ${state.hidden.size} hidden <button class="linkish" id="unhide">Restore</button>`;
  $("summary").innerHTML = summary;

  if (!state.games.length) {
    $("grid").innerHTML = `<div class="status"><b>Prices are on their way</b>The first games appear within ten minutes of launch and the full catalogue fills in over the day.</div>`;
  } else if (!list.length) {
    const last = active[active.length - 1];
    $("grid").innerHTML = state.watchOnly
      ? `<div class="empty"><b>Your watchlist is empty</b>Open a game and choose Watch price.</div>`
      : `<div class="empty"><b>Nothing matches all of that</b>${last ? `Try without <button class="linkish" data-drop="${last.id}">${esc(moodLabel(last).toLowerCase())}</button>.` : state.query.trim() ? "We may not track this game yet. Any matches from the Steam store show below." : "Try a different search."}</div>`;
  } else {
    $("grid").innerHTML = list.slice(0, state.shown).map(cardHtml).join("");
    markLoadedImages($("grid"));
  }
  $("more").hidden = list.length <= state.shown;

  if (!overlayPreview() && !list.some(g => g.id === state.selected)) state.selected = list[0]?.id ?? null;
  renderPreview();
  writeUrl();
}

function chartSvg(history) {
  const W = 380, H = 140, T = 10, B = 24;
  const start = Date.parse(history.trackedSince), end = Date.now();
  const span = Math.max(end - start, 86_400_000);
  const max = Math.max(history.regular, ...history.changes.map(c => c.price)) * 1.08 || 1;
  const x = t => ((t - start) / span) * W;
  const y = v => T + (1 - v / max) * (H - T - B);
  const points = history.changes.length ? history.changes : [{ at: history.trackedSince, price: history.current }];
  let d = `M0,${y(points[0].price)}`;
  for (const p of points.slice(1)) d += ` H${x(Date.parse(p.at)).toFixed(1)} V${y(p.price).toFixed(1)}`;
  d += ` H${W}`;
  const fmt = t => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Price since ${shortDate(history.trackedSince)}. Lowest ${money(history.lowest)}, now ${money(history.current)}.">
    <path d="${d} V${H - B} H0 Z" fill="var(--tint)" fill-opacity="0.15"/>
    <path d="${d}" fill="none" stroke="var(--tint)" stroke-width="2.6" stroke-linejoin="round"/>
    ${history.lowest < history.regular ? `<line x1="0" x2="${W}" y1="${y(history.lowest)}" y2="${y(history.lowest)}" stroke="var(--buy)" stroke-width="1.6" stroke-dasharray="5 5"/>` : ""}
    <line x1="0" x2="${W}" y1="${H - B}" y2="${H - B}" stroke="var(--line)"/>
    <circle cx="${W - 5}" cy="${y(history.current)}" r="5" fill="var(--tint)" stroke="var(--card)" stroke-width="2.5"/>
    <text x="0" y="${H - 6}" font-size="12" font-weight="600" fill="var(--sub)">${fmt(start)}</text>
    <text x="${W}" y="${H - 6}" text-anchor="end" font-size="12" font-weight="600" fill="var(--sub)">Today</text>
  </svg>`;
}

async function loadDetail(g) {
  const target = $("chart");
  try {
    const res = await fetch(`/api/games/${g.id}?region=${state.region}`);
    if (!res.ok) throw new Error(String(res.status));
    const history = await res.json();
    if (state.selected !== g.id || !document.contains(target)) return;
    const blurb = $("blurb");
    if (history.description) {
      blurb.outerHTML = `<p class="blurb" id="blurb">${esc(history.description)}</p>`;
    } else blurb.remove();
    if (history.tags.length) $("tagChips").innerHTML = history.tags.slice(0, 8).map(t => `<span>${esc(t)}</span>`).join("");
    const since = shortDate(history.trackedSince);
    target.innerHTML = history.changes.length < 2
      ? `<div class="note">Tracking since ${since}. The price has not changed since then, so there is no history to chart yet.</div>`
      : `${chartSvg(history)}
      <div class="note">Tracking since ${since}.${history.lowest < history.regular ? ` Dashed line is the lowest we have seen, ${money(history.lowest)}.` : ""}</div>`;
  } catch {
    if (!document.contains(target)) return;
    target.innerHTML = `<div class="note">Price history is not available right now.</div>`;
    $("blurb")?.remove();
  }
}

function renderPreview() {
  const el = $("preview");
  const g = byId(state.selected);
  if (!g) {
    el.innerHTML = `<div class="p-body"><p class="byline">Pick a game to see whether it is worth buying today.</p></div>`;
    return;
  }
  const v = verdictText(g);
  const tint = tints.get(g.id) ?? getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
  const watching = state.watching.has(g.id);
  const alt = converted(g.current);
  el.style.setProperty("--tint", tint);
  el.style.setProperty("--tint-ink", tint.startsWith("#") ? inkOn(tint) : "#fff");
  el.innerHTML = `
    <div class="p-hero">
      <div class="shot"><img class="fade" src="${imageUrl(g.id, "header")}" alt=""></div>
      <button class="close" id="closeBtn" aria-label="Close preview">${icon("x")}</button>
    </div>
    <div class="p-body">
      <div>
        <h2>${esc(g.name)}</h2>
        <div class="byline">${esc([g.developer, g.released, isOwned(g) && "In your library", isWished(g) && "On your wishlist"].filter(Boolean).join(" · "))}</div>
      </div>
      <div class="verdict v-${g.verdict}">
        <div class="word">${icon(v.icon)}${esc(v.word)}</div>
        <div>${esc(v.why)}</div>
        <div class="prices num">
          <span class="now">${money(g.current)}</span>${g.discount ? `<s>${money(g.regular)}</s><span class="off">-${g.discount}%</span>` : ""}
          ${alt ? `<span class="alt-big">${alt}</span>` : ""}
        </div>
      </div>
      <div class="chart">
        <p class="label">Price history</p>
        <div id="chart"><div class="skeleton skeleton-chart" aria-label="Loading price history"></div></div>
      </div>
      <dl class="facts">
        <div>${icon("star")}<dt>Reviews</dt><dd class="num">${g.positivePct !== null ? `${g.positivePct}% of ${compact(g.reviews)}` : "No reviews yet"}</dd></div>
        <div>${icon("clock")}<dt>Median playtime</dt><dd class="num">${g.medianHours ? `${g.medianHours} h` : "Not known"}</dd></div>
        <div>${icon("users")}<dt>Players</dt><dd>${g.coop ? "Solo or co-op" : "Solo or online"}</dd></div>
        <div>${icon("deck")}<dt>Steam Deck</dt><dd>${DECK_LABEL[g.deck] ?? "Unknown"}</dd></div>
      </dl>
      <div id="blurb" class="skeleton-lines" aria-label="Loading description"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
      <div class="chips" id="tagChips">${g.tags.map(t => `<span>${esc(t)}</span>`).join("")}</div>
      <div class="actions">
        <a class="btn primary" href="https://store.steampowered.com/app/${g.id}/" target="_blank" rel="noopener">Buy on Steam · ${money(g.current)} ${icon("ext")}</a>
        <button class="btn" id="watchToggle" aria-pressed="${watching}">${icon("heart")}${watching ? "Watching" : "Watch price"}</button>
        <button class="btn" data-hide="${g.id}">${icon("x")}Not for me</button>
      </div>
    </div>`;
  loadDetail(g);
}

let lastFocus = null;
function select(id) {
  state.selected = id;
  document.querySelectorAll("[data-card]").forEach(c => c.setAttribute("aria-current", Number(c.dataset.card) === id));
  renderPreview();
  writeUrl();
  $("preview").scrollTop = 0;
  if (overlayPreview()) {
    lastFocus = document.activeElement;
    $("preview").classList.add("open");
    $("scrim").hidden = false;
    $("closeBtn").focus();
  }
}

function closePreview() {
  if (!$("preview").classList.contains("open")) return;
  $("preview").classList.remove("open");
  $("scrim").hidden = true;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

let toastTimer;
function toast(message, undo) {
  const el = $("toast");
  el.innerHTML = `<span>${esc(message)}</span>${undo ? '<button id="undoBtn">Undo</button>' : ""}`;
  el.hidden = false;
  if (undo) $("undoBtn").onclick = () => { undo(); el.hidden = true; };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4500);
}

function setTheme(theme) {
  if (theme === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  store.set("bs-theme", theme);
  const next = theme === "dark" ? "light" : "dark";
  $("themeBtn").innerHTML = icon(next === "dark" ? "moon" : "sun");
  $("themeBtn").setAttribute("aria-label", `Switch to ${next} theme`);
}

const saveHidden = () => store.set("bs-hidden", [...state.hidden]);
const resetPaging = () => (state.shown = PAGE_SIZE);

function setProfile(profile) {
  state.profile = profile;
  if (!profile) state.wishOnly = false;
  $("profileName").textContent = profile?.name ?? "";
  $("profileBtn").setAttribute("aria-label", profile ? `Steam profile: ${profile.name ?? profile.steamId}` : "Connect your Steam profile");
}

async function fetchProfile(input) {
  const res = await fetch(`/api/profile?id=${encodeURIComponent(input)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Could not load that profile. Try again in a moment.");
  return { steamId: body.steamId, name: body.name, wishlist: new Set(body.wishlist), owned: body.owned ? new Set(body.owned) : null };
}

function profileSummary(p) {
  const parts = [`Connected as ${p.name ?? p.steamId}.`, `${p.wishlist.size} ${p.wishlist.size === 1 ? "game" : "games"} on your wishlist.`];
  parts.push(p.owned ? `${p.owned.size} games in your library.` : "Owned games are not available right now.");
  if (!p.wishlist.size) parts.push("If your wishlist is not empty, set it to public in your Steam privacy settings.");
  return parts.join(" ");
}

function openProfileDialog() {
  const p = state.profile;
  $("profileInput").value = p ? `https://steamcommunity.com/profiles/${p.steamId}` : "";
  $("profileStatus").textContent = p ? profileSummary(p) : "";
  $("profileStatus").classList.remove("error");
  $("profileDisconnect").hidden = !p;
  $("profileSubmit").textContent = p ? "Refresh" : "Connect";
  $("profileDialog").showModal();
}

$("profileForm").addEventListener("submit", async e => {
  e.preventDefault();
  const status = $("profileStatus");
  status.classList.remove("error");
  status.textContent = "Looking up your profile.";
  $("profileSubmit").disabled = true;
  try {
    const profile = await fetchProfile($("profileInput").value);
    setProfile(profile);
    store.set("bs-steam-id", profile.steamId);
    status.textContent = profileSummary(profile);
    $("profileDisconnect").hidden = false;
    $("profileSubmit").textContent = "Refresh";
    resetPaging();
    render();
  } catch (err) {
    status.classList.add("error");
    status.textContent = err.message;
  } finally {
    $("profileSubmit").disabled = false;
  }
});

function priceDrops() {
  const drops = [];
  for (const [id, watch] of state.watching) {
    const game = byId(id);
    if (game && watch.region === state.region && watch.price !== null && game.current < watch.price) drops.push({ game, was: watch.price });
  }
  return drops;
}

function fillWatchBaselines() {
  let changed = false;
  for (const [id, watch] of state.watching) {
    const game = byId(id);
    if (game && watch.price === null) {
      state.watching.set(id, { region: state.region, price: game.current });
      changed = true;
    }
  }
  if (changed) saveWatchlist();
}

function renderAlerts() {
  const drops = priceDrops();
  const el = $("alerts");
  el.hidden = !drops.length;
  if (!drops.length) return;
  el.innerHTML = `<div class="alerts-head">${icon("tag")}<h2>Price drops on your watchlist</h2><button class="linkish" id="dismissDrops">Mark as seen</button></div>
    <ul>${drops.map(({ game, was }) => `<li><button class="drop" data-open="${game.id}">
      <span class="drop-name">${esc(game.name)}</span>
      <span class="num"><b>${money(game.current)}</b> <s>${money(was)}</s> <span class="drop-off">-${Math.round((1 - game.current / was) * 100)}% since you added it</span></span>
    </button></li>`).join("")}</ul>`;
}

function placeholderCards() {
  const card = `<div class="card is-placeholder" aria-hidden="true"><div class="art skeleton"></div><div class="skeleton"></div><div class="skeleton" style="width:60%"></div></div>`;
  return card.repeat(8);
}

function markLoadedImages(root) {
  root.querySelectorAll("img.fade").forEach(img => {
    if (img.complete && img.naturalWidth) img.classList.add("is-loaded");
  });
}

async function loadGames() {
  $("grid").innerHTML = placeholderCards();
  const res = await fetch(`/api/games?region=${state.region}`);
  if (!res.ok) throw new Error(String(res.status));
  state.games = (await res.json()).games;
  fillWatchBaselines();
}

const NOT_A_GAME = /\b(dlc|soundtrack|ost|demo|season pass|toolkit|artbook|upgrade)\b/i;
const STEAM_RESULTS_BELOW = 3;
let searchTimer;
let searchSeq = 0;

function scheduleSteamSearch() {
  clearTimeout(searchTimer);
  const q = state.query.trim();
  if (q.length < 2) {
    searchSeq++;
    $("steamResults").hidden = true;
    $("steamResults").innerHTML = "";
    return;
  }
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&region=${state.region}`);
      const { results } = await res.json();
      if (seq === searchSeq) renderSteamResults(results.filter(r => !byId(r.id) && !NOT_A_GAME.test(r.name)));
    } catch {
      $("steamResults").hidden = true;
    }
  }, 350);
}

function renderSteamResults(results) {
  const el = $("steamResults");
  const tracked = state.games.filter(g => searchScore(g)).length;
  el.hidden = !results.length || tracked >= STEAM_RESULTS_BELOW;
  if (el.hidden) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `<p class="label">Also on Steam, not tracked here yet</p>
    <ul>${results.slice(0, 6).map(r => `<li><a class="steam-hit" href="https://store.steampowered.com/app/${r.id}/" target="_blank" rel="noopener">
      <img src="${esc(r.image)}" alt="" loading="lazy" width="120" height="45">
      <span class="steam-hit-name">${esc(r.name)}</span>
      <span class="num">${r.price ? money(r.price.current, r.price.currency) : "Free or not for sale"}</span>
      ${icon("ext")}
    </a></li>`).join("")}</ul>`;
}

async function changeRegion(region) {
  state.region = region;
  store.set("bs-region", region);
  try {
    await loadGames();
    render();
    scheduleSteamSearch();
  } catch {
    $("grid").innerHTML = `<div class="status"><b>Could not load games</b>Check your connection and try again.</div>`;
  }
}

document.addEventListener("click", e => {
  const t = e.target.closest("[data-mood],[data-sort],[data-open],[data-hide],[data-drop],#unhide,#clearFilters,#closeBtn,#watchToggle,#scrim,#watchBtn,#deckOnly,#wishOnly,#hideOwned,#themeBtn,#moreBtn,#profileBtn,#profileClose,#profileDisconnect,#dismissDrops,#regionBtn");
  if (!t) return;
  const d = t.dataset;
  if (d.mood) { state.moods.has(d.mood) ? state.moods.delete(d.mood) : state.moods.add(d.mood); state.watchOnly = false; resetPaging(); render(); }
  else if (d.sort) { state.sort = d.sort; resetPaging(); render(); }
  else if (d.open) select(Number(d.open));
  else if (d.drop) { state.moods.delete(d.drop); render(); }
  else if (d.hide) {
    const id = Number(d.hide);
    state.hidden.add(id);
    saveHidden();
    closePreview();
    render();
    toast(`Hidden ${byId(id).name}`, () => { state.hidden.delete(id); saveHidden(); render(); });
  }
  else if (t.id === "unhide") { state.hidden.clear(); saveHidden(); render(); }
  else if (t.id === "clearFilters") { state.moods.clear(); state.query = ""; $("q").value = ""; scheduleSteamSearch(); state.deckOnly = false; state.wishOnly = false; resetPaging(); render(); }
  else if (t.id === "closeBtn" || t.id === "scrim") closePreview();
  else if (t.id === "watchBtn") { state.watchOnly = !state.watchOnly; resetPaging(); render(); }
  else if (t.id === "deckOnly") { state.deckOnly = !state.deckOnly; resetPaging(); render(); }
  else if (t.id === "wishOnly") { state.wishOnly = !state.wishOnly; resetPaging(); render(); }
  else if (t.id === "hideOwned") { state.hideOwned = !state.hideOwned; store.set("bs-hide-owned", state.hideOwned); resetPaging(); render(); }
  else if (t.id === "profileBtn") openProfileDialog();
  else if (t.id === "regionBtn") $("regionDialog").showModal();
  else if (t.id === "profileClose") $("profileDialog").close();
  else if (t.id === "profileDisconnect") { setProfile(null); store.set("bs-steam-id", null); openProfileDialog(); render(); }
  else if (t.id === "themeBtn") setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  else if (t.id === "moreBtn") { state.shown += PAGE_SIZE; render(); }
  else if (t.id === "dismissDrops") {
    for (const { game } of priceDrops()) state.watching.set(game.id, { region: state.region, price: game.current });
    saveWatchlist();
    render();
  }
  else if (t.id === "watchToggle") {
    const id = state.selected, on = !state.watching.has(id);
    if (on) state.watching.set(id, { region: state.region, price: byId(id).current });
    else state.watching.delete(id);
    saveWatchlist();
    render();
    if (on) toast(`Watching ${byId(id).name}. Price drops will show at the top of this page.`);
  }
});

document.addEventListener("load", e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  img.classList.add("is-loaded");
  if (!img.dataset.tintFor) return;
  const id = Number(img.dataset.tintFor);
  if (tints.has(id)) return;
  const tint = tintFrom(img);
  if (!tint) return;
  tints.set(id, tint);
  img.closest("[data-card]")?.style.setProperty("--tint", tint);
  if (state.selected === id) {
    $("preview").style.setProperty("--tint", tint);
    $("preview").style.setProperty("--tint-ink", inkOn(tint));
  }
}, true);

document.addEventListener("error", e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (img.src.includes("library_600x900")) img.src = img.src.replace("library_600x900", "header");
  else img.classList.add("is-missing");
}, true);

document.addEventListener("keydown", e => {
  if (e.key === "Escape") closePreview();
  if (e.key === "/" && !["INPUT", "SELECT"].includes(document.activeElement.tagName)) { e.preventDefault(); $("q").focus(); }
});

$("q").addEventListener("input", e => { state.query = e.target.value; state.watchOnly = false; resetPaging(); render(); scheduleSteamSearch(); });
document.querySelectorAll(".currency-select").forEach(s => s.addEventListener("change", e => {
  state.currency = e.target.value;
  store.set("bs-currency", state.currency);
  render();
}));
document.querySelectorAll(".region-select").forEach(s => s.addEventListener("change", e => changeRegion(e.target.value)));

new IntersectionObserver(entries => {
  if (entries.some(e => e.isIntersecting) && !$("more").hidden) {
    state.shown += PAGE_SIZE;
    render();
  }
}, { rootMargin: "600px" }).observe($("more"));

async function start() {
  setTheme(store.get("bs-theme", "light"));
  $("grid").innerHTML = placeholderCards();
  $("q").value = state.query;
  try {
    const res = await fetch("/api/meta");
    if (!res.ok) throw new Error(String(res.status));
    state.meta = await res.json();
    if (!state.meta.regions.some(r => r.code === state.region)) state.region = state.meta.defaultRegion;
    if (!currencyInfo(state.currency)) state.currency = state.meta.defaultCurrency;
    renderStatic();
    const steamId = store.get("bs-steam-id", null);
    if (steamId) fetchProfile(steamId).then(p => { setProfile(p); if (state.games.length) render(); }).catch(() => {});
    await loadGames();
    render();
    scheduleSteamSearch();
    if (state.selected && overlayPreview() && byId(state.selected)) select(state.selected);
  } catch {
    $("grid").innerHTML = `<div class="status"><b>Could not load games</b>Check your connection and try again.</div>`;
  }
}

start();
