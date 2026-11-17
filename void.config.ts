import { defineConfig } from "void/config";

export default defineConfig({
  worker: {
    compatibility_date: "2026-02-24",
  },
  head: {
    title: "Boilerplate",
    htmlAttrs: { lang: "en" },
    meta: [
      { charset: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
    ],
  },
  cloudflare: {
    // `void secret put` needs this before the first deploy, and that deploy needs the secrets.
    name: "shopify-void-boilerplate",
    // Keeps wide events queryable by field in the Cloudflare dashboard. `void project logs` only tails.
    observability: { enabled: true },
  },
});
