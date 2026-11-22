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
| Wishlist and owned games | Steam community profile and Steam Web API |

### API

| Route | Returns |
| --- | --- |
| `GET /api/meta` | Store regions, currencies with rates, and a default second currency from the visitor's country |
| `GET /api/games?region=US` | Every listed game with its price and verdict in that region |
| `GET /api/games/:id/history?region=US` | Tracked price changes for one game |
| `GET /api/profile?id=<link or ID>` | A Steam profile's public wishlist, and owned games when a Steam Web API key is set |

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
3. Copy the printed `database_id` into `wrangler.jsonc` (already set for the main deployment).
4. Apply the schema: `npm run db:migrate`
5. Deploy: `npm run deploy`

### Automatic deploys

Deploys run on Cloudflare Workers Builds, connected to this repository:

1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Import a repository** and pick this repository.
2. Name the project `better-steam` to match `wrangler.jsonc`.
3. Leave the build command empty and set the deploy command to `npm run db:migrate && npx wrangler deploy`.
4. Set the production branch to `main`.

Each push to `main` then applies new migrations and deploys. To deploy by hand, start a new build from the project's **Deployments** tab. If the migration step fails, give the build's API token **D1 Edit** permission.

`.github/workflows/ci.yml` only runs the tests and type check, on every push and pull request.

### Optional: owned games

Wishlists work without any key. To also hide games people own, get a key at <https://steamcommunity.com/dev/apikey> and add it as a secret:

```bash
npx wrangler secret put STEAM_API_KEY
```

For local development, put `STEAM_API_KEY=...` in a `.dev.vars` file instead.

The cron starts filling data within ten minutes. On the free plan the full catalogue (about 850 games) has details after roughly 18 hours. Prices for every region are there within the first two hours.

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Worker, D1 schema, pricing and verdict logic | Done |
| 2 | Sync of catalogue, details, regional prices and exchange rates | Done |
| 3 | Games, history and meta API | Done |
| 4 | Storefront: moods, featured deal, preview, regions, second currency, theme toggle, watchlist, shareable filters | Done |
| 5 | CI on GitHub, automatic deploys through Cloudflare Workers Builds, and letting price history build up | Done (connect the repository in Cloudflare) |
| 6 | Backfill historical lows from IsThereAnyDeal so verdicts are accurate from day one | On hold: their API terms forbid apps that compete with IsThereAnyDeal, so this needs their written permission first |
| 7 | Connect a Steam profile to filter by wishlist and hide owned games | Done (owned games need a Steam Web API key) |
| 8 | Price-drop alerts for watched games, shown at the top of the site | Done |
| 9 | Send those alerts by email | Planned (needs an email provider and a sending domain) |

Not affiliated with Valve.
