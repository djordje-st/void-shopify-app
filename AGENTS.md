<!--injected-by-void-v1.4.0-->

## Void

- This project uses [Void](https://void.cloud), a full-stack Vite framework for Cloudflare Workers with file-based API routing, server-rendered pages, and typed backend services.
- Use Void's CLI and typed APIs. Before working with Void, read the relevant Markdown docs in `node_modules/void/docs/`; start with `guide/quickstart.md` for setup and `reference/cli.md` for commands.

<!--/injected-by-void-->

## Guidelines

- Always rely on the existing packages instead of creating something custom if feasible.
- Don't introduce unnecessary complexity or overengineer solutions, keep it simple and straightforward.
- When making routes use folders instead of a flat config.

## Shopify

- Use the Shopify AI Toolkit for Shopify API work, and check operations against the API version in `src/shopify.ts`.
- Polaris web components are on major version 2. The toolkit's Polaris references may lag behind, so `pnpm check` against `@shopify/polaris-types` decides what's valid.
- Call `authenticate(c)` first in anything that serves the embedded app. A `withValidator` schema runs before it, so don't read data in one. Use `adminFor(shop)` for background work.
- Add log fields to the current wide event with `annotate()` or `count()` from `src/wide-event.ts`. Never add tokens, query strings, or webhook payloads to it.
- Get tokens through `authenticate(c)` or `adminFor(shop)`, which read from D1's primary. Don't read the `session` table through `db` from `void/db`, which can read from a replica.
- Run `pnpm codegen` after changing a `#graphql` operation, and `pnpm exec void db generate` after changing `db/schema.ts`.
- Delete a shop's rows from any new table in the `SHOP_REDACT` handler.
- Run `pnpm check` and `pnpm test` before finishing a change. `pnpm check --fix` fixes formatting and blank lines.

See `README.md` for how the app works and for recipes.
