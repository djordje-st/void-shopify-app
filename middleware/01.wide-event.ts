import { defineMiddleware } from "void";
import { annotate, describeError, withWideEvent } from "../src/wide-event";

export default defineMiddleware((c, next) => {
  // Global middleware sends hashed build files through the Worker too, but they aren't events.
  if (c.req.path.startsWith("/assets/")) {
    return next();
  }

  return withWideEvent(
    "http.request",
    {
      request_id: c.req.header("cf-ray") ?? crypto.randomUUID(),
      method: c.req.method,
      // Never the query string: document requests carry the merchant's ID token there.
      path: c.req.path,
      colo: c.req.raw.cf?.colo,
      user_agent: c.req.header("user-agent"),
    },
    async () => {
      await next();
      annotate({ status: c.res.status });

      // Hono catches handler errors before they get here; intentional auth responses aren't errors.
      // Void catches a failed loader itself, to render pages/_error.tsx, and prints the cause.
      if (c.res.status >= 500) {
        annotate({
          error: c.error
            ? describeError(c.error)
            : { message: "Void rendered the error page and logged the cause on its own line" },
        });
      }
    },
  );
});
