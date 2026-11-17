import { defineHandler } from "void";
import { queues } from "void/queues";
import { shopify } from "../src/shopify";
import { annotate } from "../src/wide-event";

// Every topic in shopify.app.toml delivers here. Shopify allows 5 seconds for a response, so verify,
// enqueue and answer. The work happens in queues/webhooks.ts.
export const POST = defineHandler(async (c) => {
  const rawBody = await c.req.text();
  const check = await shopify().webhooks.validate({ rawBody, rawRequest: c.req.raw });

  if (!check.valid) {
    annotate({ auth_failure: check.reason });
    // Shopify's compliance check requires a 401 for an invalid HMAC.
    return c.body(null, check.reason === "invalid_hmac" ? 401 : 400);
  }

  const { topic, domain: shop, webhookId, apiVersion } = check;

  annotate({
    shop,
    topic,
    webhook_id: webhookId,
    payload_bytes: Number(c.req.header("Content-Length")),
  });

  // shortcut: Cloudflare Queues rejects messages over 128 KB, so a bigger payload fails here and
  // Shopify retries it. Trim large topics with include_fields, or move the body to R2 if you can't.
  await queues.webhooks.send({ topic, shop, webhookId, apiVersion, payload: JSON.parse(rawBody) });
});
