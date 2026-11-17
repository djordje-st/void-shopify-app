import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import wideEvent from "../middleware/01.wide-event";
import { annotate, count, withWideEvent } from "../src/wide-event";

const lines = () => {
  const calls = [...info.mock.calls, ...error.mock.calls];

  return calls.map(([line]) => JSON.parse(line as string));
};
const info = vi.spyOn(console, "info").mockImplementation(() => {});
const error = vi.spyOn(console, "error").mockImplementation(() => {});

afterEach(() => vi.clearAllMocks());

describe("withWideEvent", () => {
  it("emits one line with everything annotated along the way", async () => {
    const result = await withWideEvent("test.event", { a: 1 }, async () => {
      annotate({ b: 2 });
      count("calls");
      count("calls", 2);
      return "done";
    });

    expect(result).toBe("done");
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({ msg: "test.event", a: 1, b: 2, calls: 3 });
    expect(lines()[0].duration_ms).toBeTypeOf("number");
  });

  it("emits one error line and rethrows when the work fails", async () => {
    await expect(
      withWideEvent("test.event", {}, async () => {
        annotate({ before_failure: true });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(info).not.toHaveBeenCalled();
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({ before_failure: true, error: { message: "boom" } });
  });

  it("leaves response bodies on errors out of the log", async () => {
    const failure = Object.assign(new Error("boom"), { body: { customer: "jane@example.com" } });

    await expect(
      withWideEvent("test.event", {}, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(JSON.stringify(lines())).not.toContain("jane@example.com");
  });

  it("keeps concurrent events apart", async () => {
    await Promise.all(
      ["first", "second"].map((name) =>
        withWideEvent(name, {}, async () => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          annotate({ owner: name });
        }),
      ),
    );

    for (const line of lines()) {
      expect(line.owner).toBe(line.msg);
    }
  });

  it("ignores annotations outside an event", () => {
    expect(() => {
      annotate({ a: 1 });
      count("b");
    }).not.toThrow();
  });
});

describe("request middleware", () => {
  const app = new Hono()
    .use(wideEvent as never)
    .get("/ok", (c) => c.text("ok"))
    .get("/assets/app.js", (c) => c.text("js"))
    .get("/denied", () => {
      throw new HTTPException(401);
    })
    .get("/boom", () => {
      throw new Error("boom");
    })
    .get("/error-page", (c) => c.html("<p>Something went wrong</p>", 500))
    // Hono's default handler, without its console.error.
    .onError((failure, c) =>
      failure instanceof HTTPException ? failure.getResponse() : c.text("Failed", 500),
    );

  it("logs the path and status, but never the query string", async () => {
    await app.request("/ok?id_token=secret");

    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({ msg: "http.request", path: "/ok", status: 200 });
    expect(JSON.stringify(lines())).not.toContain("secret");
  });

  it("logs a server failure as an error", async () => {
    await app.request("/boom");

    expect(info).not.toHaveBeenCalled();
    expect(lines()[0]).toMatchObject({ status: 500, error: { message: "boom" } });
  });

  it("logs a failure Void turned into an error page as an error", async () => {
    await app.request("/error-page");

    expect(info).not.toHaveBeenCalled();
    expect(lines()[0]).toMatchObject({ status: 500, error: { message: expect.any(String) } });
  });

  it("doesn't count an intentional auth response as an error", async () => {
    await app.request("/denied");

    expect(error).not.toHaveBeenCalled();
    expect(lines()[0]).toMatchObject({ status: 401 });
  });

  it("skips hashed build files", async () => {
    await app.request("/assets/app.js");

    expect(lines()).toHaveLength(0);
  });
});
