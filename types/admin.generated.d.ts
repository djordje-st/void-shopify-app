/* eslint-disable eslint-comments/disable-enable-pair */
/* eslint-disable eslint-comments/no-unlimited-disable */
/* eslint-disable */
import type * as AdminTypes from './admin.types.js';

export type ProductCountQueryVariables = AdminTypes.Exact<{ [key: string]: never; }>;


export type ProductCountQuery = { productsCount?: AdminTypes.Maybe<Pick<AdminTypes.Count, 'count'>> };

export type CreateProductMutationVariables = AdminTypes.Exact<{
  product: AdminTypes.ProductCreateInput;
}>;


export type CreateProductMutation = { productCreate?: AdminTypes.Maybe<{ product?: AdminTypes.Maybe<Pick<AdminTypes.Product, 'id'>>, userErrors: Array<Pick<AdminTypes.UserError, 'message'>> }> };

export type LatestProductsQueryVariables = AdminTypes.Exact<{ [key: string]: never; }>;


export type LatestProductsQuery = { products: { nodes: Array<Pick<AdminTypes.Product, 'id' | 'legacyResourceId' | 'title' | 'status'>> } };

export type ProductForWebhookQueryVariables = AdminTypes.Exact<{
  id: AdminTypes.Scalars['ID']['input'];
}>;


export type ProductForWebhookQuery = { product?: AdminTypes.Maybe<Pick<AdminTypes.Product, 'status' | 'totalInventory'>> };

export type ShopDetailsQueryVariables = AdminTypes.Exact<{ [key: string]: never; }>;


export type ShopDetailsQuery = { shop: (
    Pick<AdminTypes.Shop, 'name' | 'myshopifyDomain' | 'ianaTimezone' | 'currencyCode'>
    & { plan: Pick<AdminTypes.ShopPlan, 'publicDisplayName'> }
  ) };

interface GeneratedQueryTypes {
  "#graphql\n      query ProductCount {\n        productsCount {\n          count\n        }\n      }": {return: ProductCountQuery, variables: ProductCountQueryVariables},
  "#graphql\n    query LatestProducts {\n      products(first: 20, sortKey: UPDATED_AT, reverse: true) {\n        nodes {\n          id\n          legacyResourceId\n          title\n          status\n        }\n      }\n    }": {return: LatestProductsQuery, variables: LatestProductsQueryVariables},
  "#graphql\n      query ProductForWebhook($id: ID!) {\n        product(id: $id) {\n          status\n          totalInventory\n        }\n      }": {return: ProductForWebhookQuery, variables: ProductForWebhookQueryVariables},
  "#graphql\n    query ShopDetails {\n      shop {\n        name\n        myshopifyDomain\n        ianaTimezone\n        currencyCode\n        plan {\n          publicDisplayName\n        }\n      }\n    }": {return: ShopDetailsQuery, variables: ShopDetailsQueryVariables},
}

interface GeneratedMutationTypes {
  "#graphql\n    mutation CreateProduct($product: ProductCreateInput!) {\n      productCreate(product: $product) {\n        product {\n          id\n        }\n        userErrors {\n          message\n        }\n      }\n    }": {return: CreateProductMutation, variables: CreateProductMutationVariables},
}
declare module '@shopify/admin-api-client' {
  type InputMaybe<T> = AdminTypes.InputMaybe<T>;
  interface AdminQueries extends GeneratedQueryTypes {}
  interface AdminMutations extends GeneratedMutationTypes {}
}
