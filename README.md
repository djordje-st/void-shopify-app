# Shopify app boilerplate on Void

An embedded Shopify app on [Void](https://void.cloud) and Cloudflare Workers. It leans on Void and Shopify's own libraries, so there is little code of its own to maintain.

| You get                 | How it works                                                                                 | Where                                              |
| ----------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Managed installs        | Shopify installs the app and handles scopes from the config file                             | `shopify.app.toml`                                 |
| Expiring offline tokens | Token exchange and refresh through `@shopify/shopify-api`, stored in a `session` table on D1 | `src/shopify.ts`, `db/schema.ts`                   |
| Shop details            | Name, plan, timezone, and currency copied from the Admin API into a `shop` table             | `syncShop` in `src/shopify.ts`, `db/schema.ts`     |
| Wide events             | One JSON log line per request and per webhook, through `void/log`                            | `src/wide-event.ts`, `middleware/01.wide-event.ts` |
| GraphQL types           | `#graphql` operations typed by `@shopify/api-codegen-preset`                                 | `.graphqlrc.ts`, `types/`                          |
| Webhooks                | HMAC check, then a Void queue with retries                                                   | `routes/webhooks.ts`, `queues/webhooks.ts`         |
| App proxy               | Signature check, then a Liquid response rendered in the store's theme                        | `routes/proxy/index.ts`                            |
| Polaris web components  | Polaris 2 and App Bridge from Shopify's CDN, with React 19 pages                             | `middleware/02.app-bridge.ts`, `pages/`            |
| Code style              | Oxfmt formats, and Oxlint enforces blank lines, wide-event logging, and the rules of hooks   | `vite.config.ts`, `lint/`                          |

## Develop

You need Node 24.22+ or 26.12+, pnpm, and [Shopify CLI](https://shopify.dev/docs/api/shopify-cli).

Create an app in the Dev Dashboard, then set `client_id` and `name` in `shopify.app.toml` to match it. Don't use `shopify app config link` for this: for a different app, it writes a new config from that app's settings, without this file's webhooks or app proxy.

```sh
pnpm install
pnpm dev # runs `shopify app dev`: pick a dev store, then open the preview URL
```

The CLI starts the tunnel, passes your credentials to the dev server, and installs the app on the dev store. The dev server applies database migrations when it starts. There is no `.env` to manage.

| Command                    | What it does                                    |
| -------------------------- | ----------------------------------------------- |
| `pnpm check`               | Format, lint, and type checks                   |
| `pnpm check --fix`         | Also fix formatting and blank lines             |
| `pnpm test`                | Unit tests                                      |
| `pnpm codegen`             | Regenerate GraphQL types after changing a query |
| `pnpm exec void db studio` | Browse the local database                       |

To try the app proxy, open `https://<your-store>.myshopify.com/apps/void-boilerplate`. Dev stores are usually password-protected, so enter the storefront password first.

Send a sample webhook to the running app:

```sh
shopify app webhook trigger --topic products/update --api-version 2026-10 --address http://localhost:<port>/webhooks
```

## Deploy

Shopify recommends a separate app for production. Create one in the Dev Dashboard, copy `shopify.app.toml` to `shopify.app.production.toml`, and set its `client_id` and `name`. Name your Worker with `cloudflare.name` in `void.config.ts`, then:

```sh
pnpm exec void connect --platform cloudflare # first time only
pnpm exec void secret put SHOPIFY_API_KEY
pnpm exec void secret put SHOPIFY_API_SECRET
pnpm exec void deploy                        # prints the app's URL
```

Set that URL as `application_url` in the production TOML file, set a `redirect_urls` entry on the same domain, then release the config:

```sh
shopify app deploy --config production
```

Void provisions the Worker, the queue, and the D1 database, and applies pending migrations. Commit `void.lock.json` when it changes.

## How it works

### Requests from the admin

Call `authenticate(c)` first in every loader, action, or route that serves the embedded app:

```ts
export const loader = defineHandler(async (c) => {
  const { admin } = await authenticate(c);
  const { data } = await admin.request(`#graphql
    query Home {
      shop {
        name
      }
    }`);

  return { shopName: data!.shop.name };
});
```

App Bridge adds an ID token to every `fetch`, including Void's page navigations and actions. `authenticate` verifies it, then:

- **Invalid token on a `fetch`:** answers `401` with the header that makes App Bridge retry once with a new token.
- **No valid token on a full page load:** sends the page through `routes/auth/session-token.ts`, where App Bridge fetches it again with a token.

A `withValidator` schema runs before your handler, and so before `authenticate`. Keep it to the shape of the request, and read data only after `authenticate`.

When a loader or a render fails, Void shows `pages/_error.tsx` inside the layout, and `pages/_not-found.tsx` for a URL that matches no page. A form keeps validation failures in `form.errors`. With `throwOnError: false`, as on the home page, it also keeps a failed request in `form.error`, so the form stays on screen. Without that option, 401, 403, and 5xx responses go to the error page.

### Offline tokens

Use `adminFor(shop)` for work with no merchant present, such as webhooks. It returns `undefined` if the shop has no usable token.

Tokens live in the `session` table, the same model as Shopify's app template, through `@shopify/shopify-app-session-storage-drizzle`. They're always read from D1's primary: Void turns on read replicas, and a replica could return a refresh token that has already been retired.

- **Token valid for more than 5 minutes:** used as is.
- **Merchant present:** token exchange, then a sync of the `shop` table.
- **No merchant:** refresh, storing the rotated refresh token.
- **Refresh token dead:** the session is deleted, and the next time a merchant opens the app, token exchange recovers it.
- **Access token rejected by Shopify:** it's cleared, so the next request renews it as above.

A refresh token lasts 90 days, so a shop that's idle for longer loses background access until a merchant opens the app.

Like Shopify's template, nothing stops two requests renewing the same shop at once, which [Shopify warns against](https://shopify.dev/docs/apps/build/authentication-authorization/implement-token-exchange#refresh-an-expiring-offline-token) because it can leave a retired token stored. Background calls then fail until a merchant next opens the app. If background work logs `token: "reauthorize"` for shops that are still installed, add a per-shop lock.

### Shop details

The `shop` table holds each shop's name, myshopify domain, plan, timezone, and currency, so the app can read them without calling the Admin API. `syncShop` fills it after every token exchange and on `shop/update`. The row survives an uninstall, and `shop/redact` deletes it.

Handle a missing row wherever you read it. A D1 replica can briefly miss it just after install, and a failed sync leaves it empty until the next one.

### Logs

Each request or webhook emits one line. Add to it from anywhere in that request or webhook, and don't log directly:

```ts
annotate({ plan: "pro" });
```

```json
{
  "msg": "http.request",
  "method": "GET",
  "path": "/products",
  "shop": "my-store.myshopify.com",
  "user_id": "42",
  "token": "stored",
  "admin_api_calls": 1,
  "admin_api_cost": 3,
  "admin_api_ms": 84,
  "status": 200,
  "duration_ms": 96
}
```

Query events by field under **Workers & Pages > your Worker > Observability** in Cloudflare, or tail them with `void project logs`.

Void and Shopify's session storage also print unexpected errors, so a failure can add a line beyond the wide event. When a page fails to load, Void catches the error to show `pages/_error.tsx`: the wide event records the 500, and the cause is in the line Void prints for the same request.

## Common changes

`shopify app dev` applies changes to `shopify.app.toml` to your dev store. For production, make the same change in `shopify.app.production.toml` and run `shopify app deploy --config production`.

**Remove the examples.** Delete `pages/products.tsx`, `pages/products.server.ts`, and the `s-link` to them. Delete the product form, query, and action in `pages/index.tsx` and `pages/index.server.ts`, the `PRODUCTS_UPDATE` handler with its `products/update` subscription, the product scopes, and their tests. Then run `pnpm codegen`.

**Add a page.** Create `pages/name.tsx` and `pages/name.server.ts`, call `authenticate(c)` in the loader, and add an `s-link` to `pages/layout.tsx`. Links work as `<s-link href="/name">` or `<s-button href="/name">`.

**Add a query or mutation.** Write it in a `#graphql` template literal with a unique operation name, then run `pnpm codegen`.

**Handle a webhook topic.** Add it to `shopify.app.toml` with `uri = "/webhooks"` and the scope it needs, then add a handler to `queues/webhooks.ts`. Handlers must be safe to repeat, because Shopify and Queues can both deliver a message twice.

**Add a proxied page.** Create a file under `routes/proxy/` that uses the `appProxy` middleware. If the page returns customer data, also check it against the signed `logged_in_customer_id`.

**Store more data.** Add tables to `db/schema.ts`, run `pnpm exec void db generate`, and commit the migration. Add per-shop cleanup to the `SHOP_REDACT` handler, and to the customer compliance handlers if you store customer data.

**Store another shop field.** Add it to the query and to `values` in `syncShop`, and to `shopTable` as a nullable column, because existing rows can't satisfy a required one. Then run `pnpm codegen` and `pnpm exec void db generate`.

**Change scopes.** Edit `shopify.app.toml`. Merchants approve new scopes the next time they open the app.

**Update the API version.** Change it in `src/shopify.ts`, `.graphqlrc.ts`, and `shopify.app.toml`, then run `pnpm codegen`. If `ApiVersion` has no entry for it yet, upgrade `@shopify/shopify-api` first.

**Upgrade dependencies.** Keep `graphql` and `@graphql-codegen/cli` on the major versions that `@shopify/api-codegen-preset` depends on, and `oxc-transform-react` inside the range that `@vitejs/plugin-react` accepts (`pnpm peers check` reports it). Afterwards run `pnpm build` and `pnpm codegen` as well as the checks and tests, because they fail on mismatches the others miss.

**Update Polaris.** Keep `polaris-2.js` in `middleware/02.app-bridge.ts` on the same major version as `@shopify/polaris-types`.

## Not included

Add these when an app needs them: billing, online (per-staff) tokens, CORS for UI extensions that call this backend, and the template's `app/scopes_update` webhook. That webhook keeps `session.scope` current, but nothing here reads that column, and every token renewal rewrites it.
