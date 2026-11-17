import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import { voidPlugin } from "void";
import { voidReact } from "@void/react/plugin";

// `shopify app dev` serves the app through a tunnel, and passes its URL and the port to listen on.
const appUrl = process.env.APP_URL ? new URL(process.env.APP_URL) : undefined;

export default defineConfig({
  server: {
    port: Number(process.env.PORT ?? 5173),
    ...(appUrl && {
      allowedHosts: [appUrl.hostname],
      hmr: { protocol: "wss", host: appUrl.hostname, clientPort: Number(appUrl.port) || 443 },
    }),
  },

  // Tests mock void/env, and voidPlugin would warn on every run that its variables are missing.
  plugins: process.env.VITEST ? [] : [voidPlugin(), voidReact({ react: { compiler: true } })],

  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    alias: [
      // voidPlugin sets this one everywhere else.
      { find: "@schema", replacement: fileURLToPath(new URL("./db/schema.ts", import.meta.url)) },
      // The package root also holds the Vite plugin. This has the same helpers without it.
      { find: /^void$/, replacement: "void/handler" },
    ],
  },

  // drizzle-kit writes the migrations, without a final newline.
  fmt: { ignorePatterns: ["types/**", "db/migrations/**", "void.lock.json"] },

  lint: {
    ignorePatterns: ["types/**"],
    options: { typeAware: true, typeCheck: true },
    // Setting this replaces the defaults, so they're listed too.
    plugins: ["typescript", "unicorn", "oxc", "react"],
    jsPlugins: ["@stylistic/eslint-plugin", "./lint/jsx-blank-lines.ts"],
    overrides: [{ files: ["src/wide-event.ts"], rules: { "no-restricted-imports": "off" } }],
    rules: {
      curly: "error",
      "typescript/no-deprecated": "error",
      "react/rules-of-hooks": "error",
      "react/exhaustive-deps": "error",
      // Logs go through the wide event in src/wide-event.ts.
      "no-console": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "void/log", message: "Use annotate() or count() from src/wide-event.ts." },
          ],
        },
      ],
      // Oxfmt keeps blank lines but can't add them, so `vp check --fix` adds these through Oxlint.
      "@stylistic/padding-line-between-statements": [
        "error",
        // Around a group of variables, but not inside one.
        { blankLine: "always", prev: "*", next: ["const", "let", "var"] },
        { blankLine: "always", prev: ["const", "let", "var"], next: "*" },
        { blankLine: "any", prev: ["const", "let", "var"], next: ["const", "let", "var"] },
        // Around a conditional.
        { blankLine: "always", prev: "*", next: ["if", "switch"] },
        { blankLine: "always", prev: ["if", "switch"], next: "*" },
        // Before an await that doesn't define a variable.
        {
          blankLine: "always",
          prev: "*",
          next: { selector: "ExpressionStatement[expression.type='AwaitExpression']" },
        },
      ],
      "style/jsx-blank-lines": "error",
    },
  },
});
