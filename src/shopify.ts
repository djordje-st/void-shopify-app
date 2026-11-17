import "@shopify/shopify-api/adapters/cf-worker";
import { sessionTable, shopTable } from "@schema";
import {
  ApiVersion,
  HttpResponseError,
  InvalidJwtError,
  LogSeverity,
  RequestedTokenType,
  shopifyApi,
  type Session,
} from "@shopify/shopify-api";
import { DrizzleSessionStorageSQLite } from "@shopify/shopify-app-session-storage-drizzle";
import { drizzle } from "drizzle-orm/d1";
import { HTTPException } from "hono/http-exception";
import { defineMiddleware, type CloudContext } from "void";
import { db } from "void/db";
import { env } from "void/env";
import { annotate, count } from "./wide-event";

// Shopify's app template also renews 5 minutes early, so calls in flight never outlive the token.
const RENEW_WITHIN_MS = 5 * 60 * 1000;

type LoadResult =
  | { session: Session; source: "stored" | "exchange" | "refresh" }
  | { failure: "invalid_id_token" | "reauthorize" };

function createApi() {
  return shopifyApi({
    apiKey: env.SHOPIFY_API_KEY,
    apiSecretKey: env.SHOPIFY_API_SECRET,
    // Required, but only OAuth, webhook registration and billing's default return URL read it, and
    // this app uses none of them. If you add billing, pass an explicit returnUrl.
    hostName: "app.invalid",
    apiVersion: ApiVersion.October26,
    isEmbeddedApp: true,
    // The library's warnings, such as calls it has deprecated, belong on the wide event.
    logger: {
      level: LogSeverity.Warning,
      log: (_severity, message) => annotate({ shopify_warning: message }),
    },
  });
}

let api: ReturnType<typeof createApi> | undefined;

// void/env is bound per request, so the client can't be created while the module loads.
export const shopify = () => (api ??= createApi());

// A bare binding reads from D1's primary. Tokens rotate, so a replica could return a retired one.
const sessions = () => new DrizzleSessionStorageSQLite(drizzle(env.DB as D1Database), sessionTable);

/** Stores a session. Drizzle's own error lists the query's parameters, which here are the tokens. */
async function storeSession(session: Session) {
  try {
    await sessions().storeSession(session);
  } catch (error) {
    throw new Error(`Could not store the session. ${String((error as Error).cause)}`);
  }
}

/** Authenticates a request from the embedded app and returns an Admin API client for its shop. */
export async function authenticate(c: CloudContext) {
  const idToken = c.req.header("Authorization")?.replace(/^Bearer /, "") ?? c.req.query("id_token");
  const claims = idToken
    ? await shopify()
        .session.decodeSessionToken(idToken)
        .catch(() => undefined)
    : undefined;

  if (!claims || new URL(claims.iss).hostname !== new URL(claims.dest).hostname) {
    throw reauthenticate(c, "invalid_id_token");
  }

  const shop = new URL(claims.dest).hostname;

  annotate({ shop, user_id: claims.sub });

  const result = await loadOfflineSession(shop, idToken);

  if ("failure" in result) {
    throw reauthenticate(c, result.failure);
  }

  annotate({ token: result.source });

  return { shop, admin: adminClient(result.session, c) };
}

/**
 * Returns an Admin API client for work outside a merchant session, or undefined if the shop has no
 * usable token. Only a merchant opening the app can recover from that.
 */
export async function adminFor(shop: string) {
  const result = await loadOfflineSession(shop);

  if ("failure" in result) {
    annotate({ token: result.failure });
    return undefined;
  }

  annotate({ token: result.source });

  return adminClient(result.session);
}

/**
 * Returns the shop's offline session, renewing its token when it's about to expire.
 *
 * A refresh token lasts 90 days. A shop idle for longer loses background access until a merchant
 * opens the app, which is Shopify's documented recovery.
 *
 * shortcut: like Shopify's app template, nothing stops two requests renewing one shop at once, which
 * can leave a retired token stored until a merchant next opens the app. Add a per-shop lock if
 * background work starts logging `token: "reauthorize"` for shops that are still installed.
 */
export async function loadOfflineSession(shop: string, idToken?: string): Promise<LoadResult> {
  // Not loadSession, which answers undefined when D1 fails, so an outage would look like no token.
  const stored = await sessions().findSessionsByShop(shop);
  const current = stored.find(({ isOnline }) => !isOnline);

  if (current?.isActive(undefined, RENEW_WITHIN_MS)) {
    return { session: current, source: "stored" };
  }

  let session: Session;

  try {
    if (idToken) {
      // A merchant is here, so Shopify says to acquire a new token rather than refresh one.
      ({ session } = await shopify().auth.tokenExchange({
        shop,
        sessionToken: idToken,
        requestedTokenType: RequestedTokenType.OfflineAccessToken,
        expiring: true,
      }));
    } else if (current?.refreshToken) {
      ({ session } = await shopify().auth.refreshToken({
        shop,
        refreshToken: current.refreshToken,
      }));
    } else {
      return { failure: "reauthorize" };
    }
  } catch (error) {
    const response = error instanceof HttpResponseError ? error.response : undefined;
    // Like Shopify's template, only this 400 asks for a new ID token. Others, such as a wrong
    // client secret, would fail the same way again.
    const rejected = response?.code === 400 && response.body?.error === "invalid_subject_token";

    if (idToken && (rejected || error instanceof InvalidJwtError)) {
      return { failure: "invalid_id_token" };
    }

    if (!idToken && current && response?.code === 401) {
      // Shopify says this one is final: only a new token exchange can recover the shop.
      await sessions().deleteSession(current.id);
      return { failure: "reauthorize" };
    }

    // The current token may still have minutes left, and a retry can renew it later.
    if (current?.isActive(undefined)) {
      return { session: current, source: "stored" };
    }

    throw error;
  }

  await storeSession(session);

  // Like the template's afterAuth hook. The token is stored first so that other requests can use it.
  if (idToken) {
    await syncShop(adminClient(session));
  }

  return { session, source: idToken ? "exchange" : "refresh" };
}

/** Copies the shop's details from the Admin API into the shop table. */
export async function syncShop(admin: ReturnType<typeof adminClient>) {
  const { data } = await admin.request(`#graphql
    query ShopDetails {
      shop {
        name
        myshopifyDomain
        ianaTimezone
        currencyCode
        plan {
          publicDisplayName
        }
      }
    }`);
  const { name, myshopifyDomain, ianaTimezone, currencyCode, plan } = data!.shop;
  const values = {
    myshopifyDomain,
    name,
    shopifyPlan: plan.publicDisplayName,
    timezone: ianaTimezone,
    currency: currencyCode,
  };

  await db
    .insert(shopTable)
    .values(values)
    .onConflictDoUpdate({ target: shopTable.myshopifyDomain, set: values });
}

function adminClient(session: Session, c?: CloudContext) {
  const client = new (shopify().clients.Graphql)({ session });

  // Same signature as the library's, so operations stay typed by graphql-codegen.
  const request = (async (operation: string, options?: Parameters<typeof client.request>[1]) => {
    const startedAt = Date.now();

    count("admin_api_calls");

    try {
      const response = await client.request(operation, options);

      count("admin_api_cost", response.extensions?.cost?.actualQueryCost ?? 0);
      return response;
    } catch (error) {
      if (error instanceof HttpResponseError && error.response.code === 401) {
        // Shopify rejected the token, for example after a reinstall whose webhook we never got. Like
        // the template, clear only the token, so background work can still try the refresh token.
        session.accessToken = undefined;

        await storeSession(session);

        if (c) {
          throw reauthenticate(c, "access_token_rejected");
        }
      }

      throw error;
    } finally {
      count("admin_api_ms", Date.now() - startedAt);
    }
  }) as typeof client.request;

  return { request };
}

function reauthenticate(c: CloudContext, reason: string) {
  annotate({ auth_failure: reason });

  if (c.req.header("Authorization")) {
    // App Bridge retries a request once with a fresh ID token when it sees this header.
    const headers = { "X-Shopify-Retry-Invalid-Session-Request": "1" };

    return new HTTPException(401, { res: new Response(null, { status: 401, headers }) });
  }

  // A document request has no way to ask for a new token, so send it to App Bridge. There,
  // `shopify-reload` makes App Bridge fetch this URL again with a fresh ID token.
  const url = new URL(c.req.url);

  url.searchParams.delete("id_token");

  const params = new URLSearchParams(url.search);

  params.set("shopify-reload", url.pathname + url.search);

  const res = c.redirect(`/auth/session-token?${params}`);

  return new HTTPException(302, { res });
}

/** Rejects requests that didn't come through the shop's app proxy. */
export const appProxy = defineMiddleware(async (c, next) => {
  const query = new URL(c.req.url).searchParams;
  const valid = await shopify()
    .utils.validateHmac(query, { signator: "appProxy" })
    .catch(() => false);

  if (!valid) {
    annotate({ auth_failure: "invalid_proxy_signature" });
    return c.text("Invalid signature", 401);
  }

  annotate({ shop: query.get("shop") });

  await next();
});
