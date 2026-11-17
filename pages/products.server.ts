import { defineHandler, type InferProps } from "void";
import { authenticate } from "../src/shopify";

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async (c) => {
  const { admin } = await authenticate(c);
  const { data } = await admin.request(`#graphql
    query LatestProducts {
      products(first: 20, sortKey: UPDATED_AT, reverse: true) {
        nodes {
          id
          legacyResourceId
          title
          status
        }
      }
    }`);

  return { products: data!.products.nodes };
});
