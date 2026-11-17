import { useRouter } from "@void/react";
import { useEffect, type ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();

  // Polaris announces same-origin s-link and s-button clicks this way, leaving the routing to us.
  useEffect(() => {
    const navigate = (event: Event) => {
      const href = (event.target as HTMLElement).getAttribute("href");

      if (href) {
        void router.visit(href);
      }
    };

    document.addEventListener("shopify:navigate", navigate);
    return () => document.removeEventListener("shopify:navigate", navigate);
  }, [router]);

  return (
    <>
      <s-app-nav>
        <s-link href="/products">Products</s-link>
      </s-app-nav>

      {children}
    </>
  );
}
