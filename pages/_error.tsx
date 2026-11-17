import { useRouter, type ErrorPageProps } from "@void/react";

// Void renders this inside the layout when a loader, a render, or a form that throws fails. In
// production the message is generic, and the details are in the logs.
export default function ErrorPage({ error }: ErrorPageProps) {
  const router = useRouter();

  return (
    <s-page heading="Something went wrong">
      <s-section>
        <s-stack gap="base">
          <s-paragraph>{error.message}</s-paragraph>

          <s-button onClick={() => void router.refresh()}>Try again</s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}
