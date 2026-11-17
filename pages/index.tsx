import { useForm } from "@void/react";
import type { Props } from "./index.server";

export default function HomePage({ shop, productCount }: Props) {
  const form = useForm(
    "/",
    { title: "" },
    {
      resetOnSuccess: true,
      // A failed request shows in the banner below, with the form still there to submit again.
      throwOnError: false,
      onSuccess: () => void shopify.toast.show("Product created"),
    },
  );

  return (
    <s-page heading={shop?.name}>
      {shop && (
        <s-section heading="Store">
          <s-stack gap="small">
            <s-paragraph>Plan: {shop.shopifyPlan}</s-paragraph>

            <s-paragraph>Timezone: {shop.timezone}</s-paragraph>

            <s-paragraph>Currency: {shop.currency}</s-paragraph>
          </s-stack>
        </s-section>
      )}

      <s-section heading="Products">
        <s-stack gap="base">
          <s-paragraph>
            Products in your store: {productCount}.{" "}
            <s-link href="/products">View the latest</s-link>
          </s-paragraph>

          {form.error && <s-banner tone="critical">{form.error.message}</s-banner>}

          {/*
            A plain form, because Void's <Form> also prints field errors that Polaris already shows.
            Values live in form.data, so cancel the reset React runs after an action: it would blank
            Polaris fields without updating that state.
          */}
          <form action={(data) => form.post(data)} onReset={(event) => event.preventDefault()}>
            <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="start">
              <s-text-field
                label="New product title"
                name="title"
                value={form.data.title}
                error={form.errors.title}
                onInput={(event) => form.setData("title", event.currentTarget.value)}
              />

              <s-box paddingBlockStart="large">
                <s-button type="submit" variant="primary" loading={form.pending}>
                  Create product
                </s-button>
              </s-box>
            </s-grid>
          </form>
        </s-stack>
      </s-section>
    </s-page>
  );
}
