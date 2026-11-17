// Void renders this inside the layout for any URL that matches no page or route.
export default function NotFoundPage() {
  return (
    <s-page heading="Page not found">
      <s-section>
        <s-empty-state heading="There's no page at this address">
          <s-text slot="subheading">Check the URL, or go back to the app's home page.</s-text>

          <s-button slot="primary-action" variant="primary" href="/">
            Go to home
          </s-button>
        </s-empty-state>
      </s-section>
    </s-page>
  );
}
