import { discountPercent, verdictFor, type TrackedPrice, type Verdict } from "./pricing.ts";
import { CURRENCIES } from "./regions.ts";

const VERDICT_LABEL: Record<Verdict, string> = {
  buy: "Lowest price yet",
  good: "Good price",
  sale: "On sale",
  wait: "Wait for a sale",
  steady: "Never discounted",
  full: "Full price",
};

const IMAGE_BASE = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps";

export interface SharedGame {
  id: number;
  name: string;
  headerPath: string | null;
  positive: number;
  negative: number;
  price: (TrackedPrice & { currency: string }) | null;
}

export interface ShareMeta {
  title: string;
  description: string;
  image: string;
}

function formatMoney(minor: number, code: string): string {
  const currency = CURRENCIES.find(c => c.code === code);
  const decimals = currency?.decimals ?? 2;
  const value = (minor / 100).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return currency ? currency.symbol + value : `${value} ${code}`;
}

export function shareMeta(game: SharedGame, now: Date): ShareMeta {
  const parts: string[] = [];
  if (game.price) {
    const off = discountPercent(game.price);
    parts.push(`${formatMoney(game.price.current, game.price.currency)}${off ? `, ${off}% off` : ""}.`);
    parts.push(`${VERDICT_LABEL[verdictFor(game.price, now)]}.`);
  }
  const reviews = game.positive + game.negative;
  if (reviews) parts.push(`${Math.round((game.positive / reviews) * 100)}% positive from ${reviews.toLocaleString("en-US")} reviews.`);
  return {
    title: `${game.name} on Better Steam`,
    description: parts.join(" ") || "See whether this game is worth buying today.",
    image: `${IMAGE_BASE}/${game.id}/${game.headerPath || "header.jpg"}`,
  };
}

export function withShareMeta(page: Response, meta: ShareMeta): Response {
  const set = (content: string) => ({ element: (el: Element) => { el.setAttribute("content", content); } });
  return new HTMLRewriter()
    .on("title", { element: el => { el.setInnerContent(meta.title); } })
    .on('meta[name="description"]', set(meta.description))
    .on('meta[property="og:title"]', set(meta.title))
    .on('meta[property="og:description"]', set(meta.description))
    .on('meta[name="twitter:card"]', set("summary_large_image"))
    .on("head", {
      element: el => {
        el.append(`<meta property="og:image" content="${meta.image.replace(/"/g, "&quot;")}">`, { html: true });
      },
    })
    .transform(page);
}
