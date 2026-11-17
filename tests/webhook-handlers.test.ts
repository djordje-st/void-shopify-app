import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { sessionTable, shopTable } from "../db/schema";
import { SHOP } from "./helpers";

const deleted = vi.hoisted(() => vi.fn());
const batched = vi.hoisted(() => vi.fn());
const syncShop = vi.hoisted(() => vi.fn());
const adminFor = vi.hoisted(() => vi.fn());

vi.mock("void/db", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
  db: {
    delete: (table: unknown) => ({
      where: (filter: unknown) => {
        const statement = { table, filter };

        deleted(statement);
        return statement;
      },
    }),
    batch: batched,
  },
}));
vi.mock("../src/shopify", () => ({ adminFor, syncShop }));

const { default: consume } = (await import("../queues/webhooks")) as any;
const sessionsOfShop = { table: sessionTable, filter: { column: sessionTable.shop, value: SHOP } };

async function deliver(topic: string, payload: unknown = {}, attempts = 1) {
  const message = {
    attempts,
    body: { topic, shop: SHOP, webhookId: "delivery-1", apiVersion: "2026-10", payload },
    ack: vi.fn(),
    retry: vi.fn(),
  };

  await consume({ messages: [message] });
  return message;
}

beforeEach(() => vi.clearAllMocks());

describe("webhook handlers", () => {
  it("forgets the token on uninstall and keeps the shop row", async () => {
    await deliver("APP_UNINSTALLED");

    expect(deleted).toHaveBeenCalledTimes(1);
    expect(deleted).toHaveBeenCalledWith(sessionsOfShop);
  });

  it("erases the token and the shop row on shop/redact", async () => {
    await deliver("SHOP_REDACT");

    expect(batched).toHaveBeenCalledWith([
      sessionsOfShop,
      { table: shopTable, filter: { column: shopTable.myshopifyDomain, value: SHOP } },
    ]);
  });

  it("syncs the shop table on shop/update when the shop has a token", async () => {
    const admin = {};

    adminFor.mockResolvedValue(admin);

    await deliver("SHOP_UPDATE");

    expect(syncShop).toHaveBeenCalledWith(admin);
  });

  it("skips the sync on shop/update when the shop has no token", async () => {
    adminFor.mockResolvedValue(undefined);

    const message = await deliver("SHOP_UPDATE");

    expect(syncShop).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalled();
  });

  it("acknowledges topics it doesn't handle", async () => {
    const message = await deliver("ORDERS_CREATE");

    expect(message.ack).toHaveBeenCalled();
  });

  it.each([
    [1, 60],
    [2, 120],
    [10, 3600],
  ])("retries a failed message: attempt %i waits %i seconds", async (attempts, delaySeconds) => {
    adminFor.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const message = await deliver("SHOP_UPDATE", {}, attempts);

    expect(message.retry).toHaveBeenCalledWith({ delaySeconds });
    expect(message.ack).not.toHaveBeenCalled();
  });
});
