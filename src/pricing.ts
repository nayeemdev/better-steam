export type Verdict = "buy" | "good" | "sale" | "wait" | "steady" | "full" | "free";

export interface TrackedPrice {
  regular: number;
  current: number;
  lowest: number;
  trackedSince: string;
}

const DAY_MS = 86_400_000;
const MIN_DAYS_FOR_LOW = 30;
const MIN_DAYS_FOR_STEADY = 180;
const GOOD_MARGIN = 1.25;

export function trackedDays(trackedSince: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(trackedSince)) / DAY_MS);
}

export function verdictFor(price: TrackedPrice, now: Date): Verdict {
  const onSale = price.current < price.regular;
  const days = trackedDays(price.trackedSince, now);

  if (onSale) {
    // A fresh "lowest" with little history would just be today's price, so call it a sale instead.
    if (days < MIN_DAYS_FOR_LOW) return "sale";
    if (price.current <= price.lowest) return "buy";
    if (price.current <= price.lowest * GOOD_MARGIN) return "good";
    return "wait";
  }
  if (price.lowest < price.regular) return "wait";
  return days >= MIN_DAYS_FOR_STEADY ? "steady" : "full";
}

export function discountPercent(price: { regular: number; current: number }): number {
  if (price.regular <= 0 || price.current >= price.regular) return 0;
  return Math.round((1 - price.current / price.regular) * 100);
}

const PRIOR_SCORE = 0.8;
const PRIOR_WEIGHT = 2000;

export function ratingScore(positive: number, negative: number): number {
  const total = positive + negative;
  return (positive + PRIOR_SCORE * PRIOR_WEIGHT) / (total + PRIOR_WEIGHT);
}

// Free games rank below paid deals so they do not crowd out discounts in "Best value".
const VERDICT_BONUS: Record<Verdict, number> = { buy: 0.06, good: 0.04, sale: 0.03, steady: 0.01, full: 0, wait: 0, free: -0.05 };

export function valueScore(rating: number, verdict: Verdict, discount: number): number {
  return rating + VERDICT_BONUS[verdict] + discount / 1000;
}
