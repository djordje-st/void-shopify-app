import { defineMiddleware } from "void";
import { env } from "void/env";
import { shopify } from "../src/shopify";

export default defineMiddleware(async (c, next) => {
  c.set("headDefaults", {
    meta: [{ name: "shopify-api-key", content: env.SHOPIFY_API_KEY }],
    script: [
      // App Bridge must come first, so it patches fetch and signals the admin theme to Polaris.
      { src: "https://cdn.shopify.com/shopifycloud/app-bridge.js" },
      // Keep this release in step with @shopify/polaris-types in package.json.
      { src: "https://cdn.shopify.com/shopifycloud/polaris-2.js" },
    ],
  });

  await next();

  // Every HTML response must only be frameable by this shop's admin. App Store review checks this.
  if (c.res.headers.get("Content-Type")?.startsWith("text/html")) {
    const shop = shopify().utils.sanitizeShop(c.req.query("shop") ?? "");
    const ancestors = shop
      ? `https://${shop} https://admin.shopify.com`
      : "https://admin.shopify.com";

    c.header("Content-Security-Policy", `frame-ancestors ${ancestors};`);
  }
});
