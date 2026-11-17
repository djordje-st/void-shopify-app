import { blob, index, integer, sqliteTable, text } from "void/schema-d1";

// The columns @shopify/shopify-app-session-storage-drizzle expects, the same as the Session model in
// Shopify's app template. The per-user columns stay empty until the app uses online tokens.
export const sessionTable = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    shop: text("shop").notNull(),
    state: text("state").notNull(),
    isOnline: integer("isOnline", { mode: "boolean" }).notNull().default(false),
    scope: text("scope"),
    expires: text("expires"),
    accessToken: text("accessToken").notNull(),
    userId: blob("userId", { mode: "bigint" }),
    firstName: text("firstName"),
    lastName: text("lastName"),
    email: text("email"),
    accountOwner: integer("accountOwner", { mode: "boolean" }),
    locale: text("locale"),
    collaborator: integer("collaborator", { mode: "boolean" }),
    emailVerified: integer("emailVerified", { mode: "boolean" }),
    refreshToken: text("refreshToken"),
    refreshTokenExpires: text("refreshTokenExpires"),
  },
  // The one addition to the template's model: every request loads tokens by shop, so it can't scan.
  (table) => [index("session_shop_idx").on(table.shop)],
);

// A copy of the shop's details from the Admin API, kept current by syncShop in src/shopify.ts.
export const shopTable = sqliteTable("shop", {
  myshopifyDomain: text("myshopifyDomain").primaryKey(),
  name: text("name").notNull(),
  shopifyPlan: text("shopifyPlan").notNull(),
  timezone: text("timezone").notNull(),
  currency: text("currency").notNull(),
});
