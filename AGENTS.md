# AGENTS.md

## Purpose
This repo is a multi-tenant restaurant CMS and public listing site built with Next.js, Drizzle, and Postgres.

## Stack
- Next.js App Router
- TypeScript
- Drizzle ORM + Postgres
- SCSS modules
- `pnpm`

## Working Conventions
- Use `pnpm`.
- Use TypeScript.
- Use single quotes.
- Use semicolons.
- Prefer small, coherent changes over broad rewrites.
- Do not add dependencies unless they materially simplify the code.
- Do not run `pnpm build` or `tsc` unless explicitly asked.

## Project Shape
- `app/`: routes, server actions, UI components
- `lib/`: shared business logic, auth, DB access, validation, theming
- `scripts/`: import and maintenance scripts
- `drizzle/`: migrations
- `test/`: unit and DB-backed tests

## Important Invariants
- All tenant data must remain tenant-scoped.
- Admin auth must stay tenant-aware.
- Database write rules should live in shared business logic, not be duplicated across UI/server entrypoints.
- Theme behavior should remain consistent across public and admin surfaces.
- If a change affects write logic or validation, update tests.

## Preferred Change Style
- Search for existing helpers before adding new ones.
- Prefer extracting shared logic into `lib/` over copying code.
- Prefer wrapper/layout fixes over one-off styling hacks.
- Remove dead code introduced by earlier attempts instead of layering on more special cases.

## Styling Guidance
- Match the public page tone unless there is a good reason not to.
- Reuse shared styling primitives where practical.
- Keep typography and spacing deliberate; avoid relying on browser defaults.

## Testing Guidance
- Use `pnpm test` for the existing test suite.
- Keep DB-backed tests aligned with the real migrations.
- Do not maintain a second hand-written schema for tests.

## Scripts and Migrations
- Treat Drizzle migrations as the database source of truth.
- Be careful with import scripts: they are operational tooling, not just throwaway code.

## Avoid
- Duplicating business rules in multiple layers.
- Hardcoding theme values in random files.
- Mixing tenant-agnostic logic into tenant-scoped paths.
- Large refactors without a clear payoff.
