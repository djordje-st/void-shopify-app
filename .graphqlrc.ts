import { ApiType, shopifyApiProject } from "@shopify/api-codegen-preset";

const documents = ["pages", "routes", "queues", "crons", "src"].map(
  (dir) => `./${dir}/**/*.{ts,tsx}`,
);

// Keep apiVersion in step with src/shopify.ts and shopify.app.toml.
export default {
  projects: {
    default: shopifyApiProject({
      apiType: ApiType.Admin,
      apiVersion: "2026-10",
      documents,
      outputDir: "./types",
    }),
  },
};
