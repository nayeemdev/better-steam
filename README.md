# Better Steam

A calmer way to shop on Steam. Pick a mood, see real regional prices, and get a plain answer on whether today is a good day to buy.

Purchases always happen on Steam. This site only links to the store page.

## How it works

- **Cloudflare Worker** serves the site from `public/` and a small JSON API from `src/`.
- **D1** stores games, current prices per store region, price changes and exchange rates.
- **A cron trigger** runs every 10 minutes and refreshes:
  - prices for the next 2,250 game and region pairs, picking up where the last run stopped (every region about every three hours)
  - details for ten games (description, tags, co-op, Steam Deck status)
  - image paths for 100 games, since newer Steam apps keep their art under hashed folders
  - one page of the catalogue (Steam's top 500 sellers, then SteamSpy's top 5,000 most owned games, ten pages refreshed daily) and exchange rates once a day
- **Verdicts** ("Lowest price yet", "Good price", "Wait for a sale") come from the prices we have tracked. Until a game has 30 days of history, a discount is shown as "On sale" rather than claiming a record low.

### Data sources

| Data | Source |
| --- | --- |
| Catalogue | Steam top sellers (top 500) and [SteamSpy](https://steamspy.com/api.php) most owned (top 5,000) |
| Review counts, median playtime, tags | [SteamSpy](https://steamspy.com/api.php) |
| Descriptions, co-op, regional prices | Steam store `appdetails` |
| Steam Deck compatibility | Steam store Deck report |
| Cover and header image paths | Steam `IStoreBrowseService/GetItems` |
| Exchange rates | [ExchangeRate-API open access](https://www.exchangerate-api.com/docs/free) |
| Wishlist and owned games | Steam community profile and Steam Web API |

### API

| Route | Returns |
| --- | --- |
| `GET /api/status` | Sync progress: last run and any failed steps, catalogue, details and image coverage, prices per region |
| `GET /api/meta` | Store regions, currencies with rates, and a default second currency from the visitor's country |
| `GET /api/games?region=US` | Every listed game with its price and verdict in that region |
| `GET /api/games/:id?region=US` | One game's description, tags and tracked price changes |
| `GET /api/search?q=<text>&region=US` | Steam store search, used to show games the catalogue does not track yet |
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

### Abuse protection

`/api/search` and `/api/profile` call Steam on every uncached request, so each visitor IP gets 30 of them per minute through the Workers rate limiting binding in `wrangler.jsonc`. Requests over the limit get a 429.

### Free plan limits

D1's free plan allows 100,000 rows written per day. Filling prices for the first time costs about 43,000 writes (about 4,300 games in 10 regions), spread over roughly three hours. After that, writes only happen when a price changes, plus a few thousand a day for catalogue and details updates. If a big Steam sale ever pushes past the limit, writes pause until 00:00 UTC and the site keeps serving the data it has.

### Optional: owned games

Wishlists work without any key. To also hide games people own, get a key at <https://steamcommunity.com/dev/apikey> and add it as a secret:

```bash
npx wrangler secret put STEAM_API_KEY
```

For local development, put `STEAM_API_KEY=...` in a `.dev.vars` file instead.

The cron starts filling data within ten minutes. The catalogue reaches about 4,300 paid games within the first hour, and every game with a price is listed straight away. Prices for every region are there within about three hours, and descriptions, tags and Steam Deck status fill in over about three days on the free plan.

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
