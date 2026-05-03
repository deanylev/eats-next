# Eats Next
A vibe coded successor to [eats](https://github.com/deanylev/eats) that uses a CMS

## Setup

1. Copy `.env.example` to `.env` and set `DATABASE_URL`.
2. Set admin credentials in `.env`:
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
3. To enable Google Maps restaurant autocomplete in the URL field, also set:
   - `GOOGLE_MAPS_API_KEY`
   - `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY` for the embedded public map
4. Install dependencies:

```bash
pnpm install
```

5. Run migrations:

```bash
pnpm db:migrate
```

6. Start:

```bash
pnpm dev
```

Open [http://localhost:3000/admin](http://localhost:3000/admin).
Sign in at `/admin/login` using `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

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
