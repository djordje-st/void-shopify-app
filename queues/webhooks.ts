import { sessionTable, shopTable } from "@schema";
import { defineQueue } from "void";
import { db, eq } from "void/db";
import { adminFor, syncShop } from "../src/shopify";
import { annotate, withWideEvent } from "../src/wide-event";

interface Webhook {
  topic: string;
  shop: string;
  webhookId: string;
  apiVersion: string;
  payload: any;
}

// Keyed by topic as @shopify/shopify-api reports it. Shopify and Queues can both deliver a message
// more than once, so handlers must be safe to repeat.
const handlers: Record<string, (webhook: Webhook) => Promise<unknown> | void> = {
  // The shop row stays until shop/redact, because a merchant can reinstall within those 48 hours.
  // shortcut: a retry that lands after a reinstall deletes the new token, and background work then
  // fails until a merchant opens the app. If that matters, skip tokens newer than the delivery.
  APP_UNINSTALLED: ({ shop }) => db.delete(sessionTable).where(eq(sessionTable.shop, shop)),

  // Mandatory compliance topics. This boilerplate stores no customer data. Extend these as soon as
  // you store more, within the 30 days Shopify allows.
  CUSTOMERS_DATA_REQUEST: () => {},
  CUSTOMERS_REDACT: () => {},
  SHOP_REDACT: ({ shop }) =>
    db.batch([
      db.delete(sessionTable).where(eq(sessionTable.shop, shop)),
      db.delete(shopTable).where(eq(shopTable.myshopifyDomain, shop)),
    ]),

  // The payload is ignored, so the shop table has one source: the query in syncShop.
  SHOP_UPDATE: async ({ shop }) => {
    const admin = await adminFor(shop);

    if (admin) {
      await syncShop(admin);
    }
  },

  // Example: background work with the shop's offline token, which refreshes itself when needed.
  PRODUCTS_UPDATE: async ({ shop, payload }) => {
    const admin = await adminFor(shop);

    if (!admin) {
      return;
    }

    const { data } = await admin.request(
      `#graphql
      query ProductForWebhook($id: ID!) {
        product(id: $id) {
          status
          totalInventory
        }
      }`,
      { variables: { id: payload.admin_graphql_api_id } },
    );

    annotate({ product_status: data?.product?.status, inventory: data?.product?.totalInventory });
  },
};

// Shopify already has its 200 and won't resend, so these are the only retries. With the backoff
// below they span about 5 hours.
// shortcut: Void sets no dead-letter queue, so Cloudflare deletes a message after its last retry.
// Alert on `webhook.process` errors with `attempt: 11`, which can mean a lost shop/redact.
export const maxRetries = 10;

export default defineQueue<Webhook>(async (batch) => {
  // One at a time: a shop's messages often arrive together, and renewing its token twice at once
  // can leave a retired one stored.
  for (const message of batch.messages) {
    const { topic, shop, webhookId, apiVersion } = message.body;

    await withWideEvent(
      "webhook.process",
      {
        topic,
        shop,
        webhook_id: webhookId,
        api_version: apiVersion,
        attempt: message.attempts,
        handled: topic in handlers,
      },
      async () => handlers[topic]?.(message.body),
    ).then(
      () => message.ack(),
      () => message.retry({ delaySeconds: Math.min(60 * 2 ** (message.attempts - 1), 3600) }),
    );
  }
});
