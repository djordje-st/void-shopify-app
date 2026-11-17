import type { ReactNode } from "react";

// @shopify/app-bridge-types only declares this for the global JSX namespace, which React 19 ignores.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": { children?: ReactNode };
    }
  }
}
