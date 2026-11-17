import type { Props } from "./products.server";

export default function ProductsPage({ products }: Props) {
  return (
    <s-page heading="Products">
      <s-section padding="none" accessibilityLabel="Latest products">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Title</s-table-header>

            <s-table-header listSlot="secondary">Status</s-table-header>
          </s-table-header-row>

          <s-table-body>
            {products.map((product) => (
              <s-table-row key={product.id}>
                <s-table-cell>
                  <s-link href={`shopify://admin/products/${product.legacyResourceId}`}>
                    {product.title}
                  </s-link>
                </s-table-cell>

                <s-table-cell>
                  <s-badge tone={product.status === "ACTIVE" ? "success" : "neutral"}>
                    {product.status}
                  </s-badge>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}
