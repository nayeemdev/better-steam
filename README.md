# Better Steam

A calmer way to shop on Steam. Pick a mood, see real regional prices, and get a plain answer on whether today is a good day to buy.

Purchases always happen on Steam. This site only links to the store page.

## How it works

- **Cloudflare Worker** serves the site from `public/` and a small JSON API from `src/`.
- **D1** stores games, current prices per store region, price changes and exchange rates.
- **A cron trigger** runs every 10 minutes and refreshes:
  - one store region's prices (all ten regions every 100 minutes)
  - details for eight games (name, description, tags, co-op, Steam Deck status)
  - the catalogue and exchange rates once a day
- **Verdicts** ("Lowest price yet", "Good price", "Wait for a sale") come from the prices we have tracked. Until a game has 30 days of history, a discount is shown as "On sale" rather than claiming a record low.

### Data sources

| Data | Source |
| --- | --- |
| Catalogue, review counts, median playtime, tags | [SteamSpy](https://steamspy.com/api.php) |
| Descriptions, co-op, regional prices | Steam store `appdetails` |
| Steam Deck compatibility | Steam store Deck report |
| Exchange rates | [ExchangeRate-API open access](https://www.exchangerate-api.com/docs/free) |

### API

| Route | Returns |
| --- | --- |
| `GET /api/meta` | Store regions, currencies with rates, and a default second currency from the visitor's country |
| `GET /api/games?region=US` | Every listed game with its price and verdict in that region |
| `GET /api/games/:id/history?region=US` | Tracked price changes for one game |

## Local development

Requires Node 22 or later.

```bash
npm install
```

```bash
npm run db:migrate:local
```

```bash
npx wrangler dev --test-scheduled
```

The first sync does not run on its own locally. Trigger it, and repeat to fill in more games:

```bash
curl "http://localhost:8787/__scheduled?cron=*/10+*+*+*+*"
```

Checks:

```bash
npm test
```

```bash
npm run typecheck
```

## Deploy to Cloudflare

1. Log in: `npx wrangler login`
2. Create the database: `npx wrangler d1 create better-steam`
3. Copy the printed `database_id` into `wrangler.jsonc`.
4. Apply the schema: `npm run db:migrate`
5. Deploy: `npm run deploy`

The cron starts filling data within ten minutes. On the free plan the full catalogue (about 850 games) has details after roughly 18 hours. Prices for every region are there within the first two hours.

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Worker, D1 schema, pricing and verdict logic | Done |
| 2 | Sync of catalogue, details, regional prices and exchange rates | Done |
| 3 | Games, history and meta API | Done |
| 4 | Storefront: moods, featured deal, preview, regions, second currency, theme toggle, watchlist, shareable filters | Done |
| 5 | Deploy to Cloudflare and let price history build up | Next |
| 6 | Backfill historical lows from IsThereAnyDeal so verdicts are accurate from day one (needs an API key) | Planned |
| 7 | Hide owned games and import a wishlist from a Steam profile (needs a Steam Web API key) | Planned |
| 8 | Price alerts for watched games by email (needs an email provider) | Planned |

Not affiliated with Valve.
