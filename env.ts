import { defineEnv, string } from "void/env";

// `shopify app dev` provides these locally; set them with `void secret put` for production.
export default defineEnv({
  SHOPIFY_API_KEY: string(),
  SHOPIFY_API_SECRET: string(),
});
