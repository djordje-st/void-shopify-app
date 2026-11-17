import { shopTable } from "@schema";
import * as v from "valibot";
import { defineHandler, type InferProps } from "void";
import { db, eq } from "void/db";
import { ValidationError } from "void/handler";
import { authenticate } from "../src/shopify";

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async (c) => {
  const { admin, shop } = await authenticate(c);
  const [{ data }, details] = await Promise.all([
    admin.request(`#graphql
      query ProductCount {
        productsCount {
          count
        }
      }`),
    db.select().from(shopTable).where(eq(shopTable.myshopifyDomain, shop)).get(),
  ]);

  // A D1 replica can briefly miss the row just after install, so the page handles null.
  return { shop: details ?? null, productCount: data!.productsCount?.count ?? 0 };
});

export const action = defineHandler.withValidator({
  body: v.object({ title: v.pipe(v.string(), v.trim(), v.nonEmpty("Enter a title")) }),
})(async (c, { body }) => {
  const { admin } = await authenticate(c);
  const { data } = await admin.request(
    `#graphql
    mutation CreateProduct($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product {
          id
        }
        userErrors {
          message
        }
      }
    }`,
    { variables: { product: { title: body.title } } },
  );
  const userError = data!.productCreate?.userErrors[0];

  if (userError) {
    throw new ValidationError({ title: userError.message });
  }
});
