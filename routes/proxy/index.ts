import { defineHandler } from "void";
import { appProxy } from "../../src/shopify";

// Merchants can change the storefront path, so build links back to this page from the signed
// `path_prefix` query parameter, not a hardcoded one. Keep request input out of the Liquid source.
const page = `<h1>Hello from {{ shop.name }}</h1>
{% if customer %}
  <p>Welcome back, {{ customer.first_name | escape }}.</p>
{% else %}
  <p>This page is rendered by your app, inside the store's theme.</p>
{% endif %}`;

// Add more proxied pages as files under routes/proxy, each using the appProxy middleware.
export const GET = defineHandler(
  appProxy,
  () => new Response(page, { headers: { "Content-Type": "application/liquid" } }),
);
