import type { Session } from "@shopify/shopify-api";
import { setAbstractFetchFunc } from "@shopify/shopify-api/runtime";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  API_KEY,
  API_SECRET,
  SHOP,
  idToken,
  jsonError,
  jsonResponse,
  offlineSession,
  tokenResponse,
} from "./helpers";

const stored = vi.hoisted(() => new Map<string, unknown>());
const findSessions = vi.hoisted(() => vi.fn());
const storeSession = vi.hoisted(() => vi.fn());
const upsertShop = vi.hoisted(() => vi.fn());

vi.mock("void/db", () => ({
  db: {
    insert: () => ({
      values: (values: unknown) => ({ onConflictDoUpdate: () => upsertShop(values) }),
    }),
  },
}));
// Node has no D1, and the decisions around the storage are what's under test.
vi.mock("@shopify/shopify-app-session-storage-drizzle", () => ({
  DrizzleSessionStorageSQLite: class {
    findSessionsByShop = findSessions;
    storeSession = storeSession;
    deleteSession = (id: string) => stored.delete(id);
  },
}));

const { adminFor, loadOfflineSession } = await import("../src/shopify");

const SESSION_ID = `offline_${SHOP}`;
const MINUTE = 60 * 1000;
const inFuture = (ms: number) => new Date(Date.now() + ms);
const storedSession = () => stored.get(SESSION_ID) as Session | undefined;

function storeToken(expires: Date) {
  const session = offlineSession({
    accessToken: "access-1",
    expires,
    refreshToken: "refresh-1",
    refreshTokenExpires: inFuture(90 * 24 * 60 * MINUTE),
  });

  stored.set(SESSION_ID, session);
  return session;
}

const shopDetails = {
  data: {
    shop: {
      name: "Test Shop",
      myshopifyDomain: SHOP,
      ianaTimezone: "Europe/Belgrade",
      currencyCode: "EUR",
      plan: { publicDisplayName: "Basic" },
    },
  },
};

const fetchMock = vi.fn<(url: string, init: { body: string }) => Promise<Response>>();
const requestBody = () => JSON.parse(fetchMock.mock.calls[0]![1].body);

// Answers the token endpoint and the Admin API differently.
function shopifyAnswers(token: () => Response, graphql = () => jsonResponse(shopDetails)) {
  fetchMock.mockImplementation(async (url) =>
    url.endsWith("/graphql.json") ? graphql() : token(),
  );
}

beforeEach(() => {
  stored.clear();
  findSessions.mockReset();
  findSessions.mockImplementation(() => [...stored.values()]);
  storeSession.mockReset();
  storeSession.mockImplementation((session: { id: string }) => stored.set(session.id, session));
  upsertShop.mockReset();
  fetchMock.mockReset();
  setAbstractFetchFunc(fetchMock as never);
});

describe("loadOfflineSession", () => {
  it("reuses a token that is not close to expiring", async () => {
    const session = storeToken(inFuture(30 * MINUTE));

    await expect(loadOfflineSession(SHOP)).resolves.toEqual({ session, source: "stored" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exchanges the ID token for an expiring offline token on first use", async () => {
    shopifyAnswers(() => tokenResponse("access-2", "refresh-2"));

    await expect(loadOfflineSession(SHOP, idToken())).resolves.toMatchObject({
      source: "exchange",
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(`https://${SHOP}/admin/oauth/access_token`);
    expect(requestBody()).toMatchObject({
      client_id: API_KEY,
      client_secret: API_SECRET,
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
      expiring: "1",
    });
    expect(storedSession()).toMatchObject({ accessToken: "access-2", refreshToken: "refresh-2" });
  });

  it("copies the shop's details into the shop table after an exchange", async () => {
    shopifyAnswers(() => tokenResponse("access-2", "refresh-2"));

    await loadOfflineSession(SHOP, idToken());

    expect(upsertShop).toHaveBeenCalledWith({
      myshopifyDomain: SHOP,
      name: "Test Shop",
      shopifyPlan: "Basic",
      timezone: "Europe/Belgrade",
      currency: "EUR",
    });
  });

  it("keeps the new token when the shop sync fails, so the next request can use it", async () => {
    shopifyAnswers(
      () => tokenResponse("access-2", "refresh-2"),
      () => jsonError(500),
    );

    await expect(loadOfflineSession(SHOP, idToken())).rejects.toThrow();
    expect(storedSession()).toMatchObject({ accessToken: "access-2" });
  });

  it("keeps the tokens out of the error when they can't be stored", async () => {
    shopifyAnswers(() => tokenResponse("access-2", "refresh-2"));
    // The shape of Drizzle's error for a failed query.
    storeSession.mockRejectedValueOnce(
      new Error("Failed query: insert into session\nparams: access-2,refresh-2", {
        cause: new Error("D1_ERROR: database is locked"),
      }),
    );

    const failure: Error = await loadOfflineSession(SHOP, idToken()).catch((error) => error);

    expect(failure.message).toBe(
      "Could not store the session. Error: D1_ERROR: database is locked",
    );
    expect(failure.stack).not.toContain("access-2");
    expect(failure.cause).toBeUndefined();
  });

  it("fails on a 400 that isn't about the ID token, which a new one wouldn't fix", async () => {
    shopifyAnswers(() => jsonError(400, { error: "invalid_client" }));

    await expect(loadOfflineSession(SHOP, idToken())).rejects.toThrow("400");
  });

  it("exchanges rather than refreshes when a merchant is present", async () => {
    storeToken(inFuture(MINUTE));
    shopifyAnswers(() => tokenResponse("access-2", "refresh-2"));

    await expect(loadOfflineSession(SHOP, idToken())).resolves.toMatchObject({
      source: "exchange",
    });
  });

  it("refreshes in the background and stores the rotated refresh token", async () => {
    storeToken(inFuture(MINUTE));
    shopifyAnswers(() => tokenResponse("access-2", "refresh-2"));

    await expect(loadOfflineSession(SHOP)).resolves.toMatchObject({ source: "refresh" });
    expect(requestBody()).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "refresh-1",
    });
    expect(storedSession()).toMatchObject({ accessToken: "access-2", refreshToken: "refresh-2" });
    expect(upsertShop).not.toHaveBeenCalled();
  });

  it("forgets the shop when Shopify says the refresh token is final", async () => {
    storeToken(inFuture(MINUTE));
    shopifyAnswers(() => jsonError(401, { error: "invalid_request" }));

    await expect(loadOfflineSession(SHOP)).resolves.toEqual({ failure: "reauthorize" });
    expect(storedSession()).toBeUndefined();
  });

  it("reports a rejected ID token and keeps the stored token", async () => {
    const session = storeToken(inFuture(MINUTE));

    shopifyAnswers(() => jsonError(400, { error: "invalid_subject_token" }));

    await expect(loadOfflineSession(SHOP, idToken())).resolves.toEqual({
      failure: "invalid_id_token",
    });
    expect(storedSession()).toBe(session);
  });

  it("asks for reauthorization when there is nothing to refresh with", async () => {
    await expect(loadOfflineSession(SHOP)).resolves.toEqual({ failure: "reauthorize" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps using a token with minutes left when a refresh fails transiently", async () => {
    const session = storeToken(inFuture(MINUTE));

    shopifyAnswers(() => jsonError(503));

    await expect(loadOfflineSession(SHOP)).resolves.toEqual({ session, source: "stored" });
    expect(storedSession()?.refreshToken).toBe("refresh-1");
  });

  it("throws so the caller can retry when an expired token cannot refresh yet", async () => {
    storeToken(inFuture(-MINUTE));
    shopifyAnswers(() => jsonError(503));

    await expect(loadOfflineSession(SHOP)).rejects.toThrow();
    expect(storedSession()?.refreshToken).toBe("refresh-1");
  });

  it("throws so the caller can retry when the database can't be read", async () => {
    findSessions.mockRejectedValueOnce(new Error("D1_ERROR"));

    await expect(loadOfflineSession(SHOP)).rejects.toThrow("D1_ERROR");
  });

  it("refreshes after Shopify rejects a token in the background", async () => {
    storeToken(inFuture(30 * MINUTE));
    shopifyAnswers(
      () => tokenResponse("access-2", "refresh-2"),
      () => jsonError(401),
    );

    const admin = await adminFor(SHOP);

    await expect(admin!.request("query { shop { name } }")).rejects.toThrow();
    expect(storedSession()).toMatchObject({ accessToken: undefined, refreshToken: "refresh-1" });

    await expect(loadOfflineSession(SHOP)).resolves.toMatchObject({ source: "refresh" });
  });
});
