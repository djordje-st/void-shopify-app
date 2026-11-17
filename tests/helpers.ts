import { createHmac } from "node:crypto";
import { Session, type SessionParams } from "@shopify/shopify-api";

export const API_KEY = "test-key";
export const API_SECRET = "test-secret";
export const SHOP = "test-shop.myshopify.com";

/** A shop's stored offline session, valid for an hour unless `params` say otherwise. */
export const offlineSession = (params: Partial<SessionParams> = {}) =>
  new Session({
    id: `offline_${SHOP}`,
    shop: SHOP,
    state: "",
    isOnline: false,
    accessToken: "access",
    expires: new Date(Date.now() + 60 * 60 * 1000),
    ...params,
  });

const base64Url = (value: string) => Buffer.from(value).toString("base64url");

export function idToken(claims: Record<string, unknown> = {}, secret = API_SECRET) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: `https://${SHOP}/admin`,
    dest: `https://${SHOP}`,
    aud: API_KEY,
    sub: "42",
    exp: now + 60,
    nbf: now - 1,
    ...claims,
  };
  const unsigned = `${base64Url('{"alg":"HS256","typ":"JWT"}')}.${base64Url(JSON.stringify(payload))}`;

  return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}

export const hmac = (body: string, secret = API_SECRET) =>
  createHmac("sha256", secret).update(body).digest("base64");

/** Builds the query string the app proxy signs, using Shopify's documented algorithm. */
export function proxyQuery(params: [string, string][], secret = API_SECRET) {
  const values = new Map<string, string[]>();

  for (const [key, value] of params) {
    values.set(key, [...(values.get(key) ?? []), value]);
  }

  const message = [...values]
    .map(([key, list]) => `${key}=${list.join(",")}`)
    .sort()
    .join("");
  const query = new URLSearchParams(params);

  query.set("signature", createHmac("sha256", secret).update(message).digest("hex"));
  return query;
}

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const jsonError = (status: number, body: unknown = { error: "nope" }) =>
  jsonResponse(body, status);

/** A Shopify token endpoint response for an expiring offline token. */
export const tokenResponse = (accessToken: string, refreshToken: string) =>
  jsonResponse({
    access_token: accessToken,
    scope: "read_products",
    expires_in: 3600,
    refresh_token: refreshToken,
    refresh_token_expires_in: 7776000,
  });
