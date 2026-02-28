# Eats Next
A vibe coded successor to [eats](https://github.com/deanylev/eats) that uses a CMS

## Setup

1. Copy `.env.example` to `.env` and set `DATABASE_URL`.
2. Set admin credentials in `.env`:
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
3. Install dependencies:

```bash
pnpm install
```

4. Generate and push DB schema:

```bash
pnpm db:generate
pnpm db:push
```

5. Start:

```bash
pnpm dev
```

Open [http://localhost:3000/admin](http://localhost:3000/admin).
The `/admin` route is protected by HTTP Basic Auth using `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

## Import Existing Restaurants

This project includes an importer for your legacy `~/workspace/eats/index.html` data.

It imports:
- `triedPlaces` as status `liked`
- `wantedPlaces` as status `untried`

It ignores:
- `globalPlaces`

Run with explicit source path:

```bash
pnpm import:legacy /absolute/path/to/index.html
```

Equivalent:

```bash
pnpm exec tsx scripts/import-legacy-restaurants.ts /absolute/path/to/index.html
```

## Rule Enforcement

Restaurant validation includes:

- Areas: zero or more free-form lines
- Meal types: at least 1, at most 4 from `snack`, `breakfast`, `lunch`, `dinner`
- At least 1 restaurant type
- `referredBy`: required, accepts URL or free text
- URL rules:
  - `< 2` areas: URL must be Google Maps
  - `>= 2` areas: URL must not be Google Maps
- Status: `untried`, `liked`, `disliked`
- If status is `disliked`, `dislikedReason` is required
