import { vi } from "vite-plus/test";
import { API_KEY, API_SECRET } from "./helpers";

// Node has no Worker bindings. Tests that reach D1 mock whatever reads it.
vi.mock("void/env", () => ({
  env: { SHOPIFY_API_KEY: API_KEY, SHOPIFY_API_SECRET: API_SECRET, DB: {} },
}));
