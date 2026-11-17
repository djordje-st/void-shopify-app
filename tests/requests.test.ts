import { setAbstractFetchFunc } from "@shopify/shopify-api/runtime";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { convertReturnValue } from "void/response";
import { API_KEY, SHOP, hmac, idToken, jsonResponse, offlineSession, proxyQuery } from "./helpers";

const send = vi.hoisted(() => vi.fn());
const storage = vi.hoisted(() => ({
  findSessionsByShop: vi.fn(),
  storeSession: vi.fn(),
  deleteSession: vi.fn(),
}));

vi.mock("void/db", () => ({ db: {} }));
vi.mock("void/queues", () => ({ queues: { webhooks: { send } } }));
// Node has no D1, and how requests use the storage is what's under test.
vi.mock("@shopify/shopify-app-session-storage-drizzle", () => ({
  DrizzleSessionStorageSQLite: class {
    findSessionsByShop = storage.findSessionsByShop;
    storeSession = storage.storeSession;
    deleteSession = storage.deleteSession;
  },
}));

const { POST: webhooks } = await import("../routes/webhooks");
const { GET: proxy } = await import("../routes/proxy/index");
const { authenticate } = await import("../src/shopify");
const { action: createProduct } = await import("../pages/index.server");
const { default: appBridge } = await import("../middleware/02.app-bridge");

// Void's router converts handler return values the same way.
const route = (handler: any) => async (c: any) => convertReturnValue(await handler(c));

const app = new Hono()
  .post("/webhooks", route(webhooks))
  .get("/proxy", route(proxy))
  .post("/", route(createProduct))
  .get("/page", async (c) => {
    const { shop } = await authenticate(c as never);

    return c.text(shop);
  });

beforeEach(() => vi.clearAllMocks());

describe("POST /webhooks", () => {
  const deliver = (body: string, signature: string) =>
    app.request("/webhooks", {
      method: "POST",
      body,
      headers: {
        "X-Shopify-Topic": "app/uninstalled",
        "X-Shopify-Shop-Domain": SHOP,
        "X-Shopify-API-Version": "2026-10",
        "X-Shopify-Webhook-Id": "delivery-1",
        "X-Shopify-Hmac-Sha256": signature,
      },
    });

  it("enqueues a verified delivery", async () => {
    const body = JSON.stringify({ id: 1 });
    const response = await deliver(body, hmac(body));

    expect(response.ok).toBe(true);
    expect(send).toHaveBeenCalledWith({
      topic: "APP_UNINSTALLED",
      shop: SHOP,
      webhookId: "delivery-1",
      apiVersion: "2026-10",
      payload: { id: 1 },
    });
  });

  it("answers 401 to a bad HMAC, as the compliance check requires", async () => {
    const response = await deliver("{}", hmac("{}", "wrong-secret"));

    expect(response.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it("fails the delivery when it cannot be queued, so Shopify retries", async () => {
    send.mockRejectedValueOnce(new Error("Message too large"));

    const response = await deliver("{}", hmac("{}"));

    expect(response.status).toBe(500);
  });
});

describe("GET /proxy", () => {
  const params = (timestamp = Math.floor(Date.now() / 1000)): [string, string][] => [
    ["shop", SHOP],
    ["logged_in_customer_id", ""],
    ["path_prefix", "/apps/void-boilerplate"],
    ["timestamp", String(timestamp)],
    ["extra", "1"],
    ["extra", "2"],
  ];

  it("renders Liquid for a signed request, including repeated params", async () => {
    const response = await app.request(`/proxy?${proxyQuery(params())}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/liquid");
  });

  it.each([
    ["a bad signature", () => proxyQuery(params(), "wrong-secret")],
    ["a replayed request", () => proxyQuery(params(Math.floor(Date.now() / 1000) - 600))],
    ["no signature", () => new URLSearchParams(params())],
  ])("rejects %s", async (_name, query) => {
    const response = await app.request(`/proxy?${query()}`);

    expect(response.status).toBe(401);
  });
});

describe("POST / (create product)", () => {
  const create = (title: string, target = app) =>
    target.request("/", {
      method: "POST",
      body: JSON.stringify({ title }),
      headers: { Authorization: `Bearer ${idToken()}` },
    });

  it("reports a blank title on its field, which the form shows", async () => {
    const response = await create("   ");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Validation failed",
      issues: [{ slot: "body", issues: [{ message: "Enter a title", path: "title" }] }],
    });
  });

  it("creates the product with a trimmed title", async () => {
    const fetchMock = vi.fn<(url: string, init: { body: string }) => Promise<Response>>();

    fetchMock.mockResolvedValue(
      jsonResponse({ data: { productCreate: { product: { id: "1" }, userErrors: [] } } }),
    );
    storage.findSessionsByShop.mockResolvedValue([offlineSession()]);
    setAbstractFetchFunc(fetchMock as never);

    const response = await create("  Shoes  ");

    expect(response.ok).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).variables.product.title).toBe("Shoes");
  });

  it("reports Shopify's own error on the title field", async () => {
    const userErrors = [{ message: "Title is too long" }];
    const thrown = vi.fn();
    // Void's router turns this error into the 400 the form reads. Hono alone only reports it.
    const failing = new Hono().post("/", route(createProduct)).onError((error, c) => {
      thrown(error);
      return c.body(null, 500);
    });

    storage.findSessionsByShop.mockResolvedValue([offlineSession()]);
    setAbstractFetchFunc((async () =>
      jsonResponse({ data: { productCreate: { product: null, userErrors } } })) as never);

    await create("Shoes", failing);

    expect(thrown).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ValidationError", errors: { title: "Title is too long" } }),
    );
  });
});

describe("authenticate", () => {
  const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

  it("loads the token for the shop in the verified ID token", async () => {
    storage.findSessionsByShop.mockResolvedValue([offlineSession()]);

    const response = await app.request("/page", bearer(idToken()));

    expect(await response.text()).toBe(SHOP);
    expect(storage.findSessionsByShop).toHaveBeenCalledWith(SHOP);
  });

  it("accepts the ID token Shopify puts on a document URL", async () => {
    storage.findSessionsByShop.mockResolvedValue([offlineSession()]);

    const response = await app.request(`/page?id_token=${idToken()}`);

    expect(response.status).toBe(200);
  });

  it.each([
    ["is signed with the wrong secret", () => idToken({}, "wrong-secret")],
    ["is for another app", () => idToken({ aud: `not-${API_KEY}` })],
    ["has expired", () => idToken({ exp: 1000, nbf: 900 })],
    [
      "has an issuer that differs from its shop",
      () => idToken({ iss: "https://evil.myshopify.com/admin" }),
    ],
  ])("asks App Bridge to retry when the token %s", async (_name, token) => {
    const response = await app.request("/page", bearer(token()));

    expect(response.status).toBe(401);
    expect(response.headers.get("X-Shopify-Retry-Invalid-Session-Request")).toBe("1");
    expect(storage.findSessionsByShop).not.toHaveBeenCalled();
  });

  it("bounces a document request without a token through App Bridge", async () => {
    const response = await app.request(`/page?shop=${SHOP}&host=abc&embedded=1`);

    expect(response.status).toBe(302);

    const location = new URL(response.headers.get("Location")!, "https://app.example.com");

    expect(location.pathname).toBe("/auth/session-token");
    expect(location.searchParams.get("shop")).toBe(SHOP);
    expect(location.searchParams.get("shopify-reload")).toBe(
      `/page?shop=${SHOP}&host=abc&embedded=1`,
    );
  });

  it("never carries a stale ID token through the bounce", async () => {
    const stale = idToken({ exp: 1000, nbf: 900 });
    const response = await app.request(`/page?shop=${SHOP}&id_token=${stale}`);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).not.toContain("id_token");
  });

  it("clears a token Shopify rejects and has App Bridge retry", async () => {
    storage.findSessionsByShop.mockResolvedValue([offlineSession()]);
    setAbstractFetchFunc((async () => new Response("{}", { status: 401 })) as never);

    const authed = new Hono().get("/query", async (c) => {
      const { admin } = await authenticate(c as never);

      await admin.request("query { shop { name } }");
      return c.text("unreachable");
    });
    const response = await authed.request("/query", bearer(idToken()));

    expect(storage.storeSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: `offline_${SHOP}`, accessToken: undefined }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("X-Shopify-Retry-Invalid-Session-Request")).toBe("1");
  });
});

describe("frame-ancestors", () => {
  const framed = new Hono()
    .use(appBridge as never)
    .get("/page", (c) => c.html("<p>Hi</p>"))
    .get("/data", (c) => c.json({}));
  const policy = async (url: string) =>
    (await framed.request(url)).headers.get("Content-Security-Policy");

  it("lets only the shop's admin frame an HTML response", async () => {
    expect(await policy(`/page?shop=${SHOP}`)).toBe(
      `frame-ancestors https://${SHOP} https://admin.shopify.com;`,
    );
  });

  it("ignores a shop parameter that isn't a Shopify domain", async () => {
    expect(await policy("/page?shop=evil.example.com")).toBe(
      "frame-ancestors https://admin.shopify.com;",
    );
  });

  it("leaves other responses alone", async () => {
    expect(await policy(`/data?shop=${SHOP}`)).toBeNull();
  });
});
