import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // --- Architecture boundary -------------------------------------------
  // The worker is a bare Node process that imports lib/services, lib/psi,
  // lib/queue, lib/report and lib/sitemap directly. A single `next/*` or
  // `react` import anywhere in that tree breaks it at load time, and the same
  // boundary is what lets the stage-6 MCP server reuse the service layer
  // untouched.
  //
  // If you edit this rule, re-verify it still bites:
  //   echo "import 'next/headers';" >> lib/services/_probe.ts && npm run lint
  // It must FAIL. An unenforced boundary is decorative.
  {
    files: [
      "lib/services/**/*.ts",
      "lib/psi/**/*.ts",
      "lib/queue/**/*.ts",
      "lib/report/**/*.ts",
      "lib/sitemap/**/*.ts",
      "lib/env.ts",
      "lib/db.ts",
      "lib/logger.ts",
      "lib/errors.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "next",
                "next/*",
                "react",
                "react-dom",
                "react/*",
                "server-only",
                "client-only",
                "@/app/*",
                "@/components/*",
                "@/lib/http/*",
                // The `@/*` alias is a bundler/tsc concept. Node's native TS
                // stripping does not resolve it, so `node --test` and the bare
                // worker process would both fail. Use relative imports with an
                // explicit .ts extension inside this tree.
                "@/lib/*",
              ],
              message:
                "Framework-free zone: the worker imports this module as plain Node. Put Next/React-aware code in lib/http/, app/, or components/ instead.",
            },
          ],
        },
      ],
    },
  },

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "node_modules/**",
    // Vendored Ship Studio plugin source -- not ours to lint or fix.
    ".shipstudio/**",
  ]),
]);

export default eslintConfig;
