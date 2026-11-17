import { defineHandler } from "void";
import { env } from "void/env";

// App Bridge reads `shopify-reload` from this page's URL and replaces the page with that URL,
// fetched with a fresh ID token. The message only stays visible outside the Shopify admin.
export const GET = defineHandler((c) =>
  c.html(`<!doctype html>
<meta name="shopify-api-key" content="${env.SHOPIFY_API_KEY}">
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
<p>Open this app from your Shopify admin.</p>`),
);
