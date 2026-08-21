import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // --- Architecture boundary -------------------------------------------
  // node --test's native TS stripping and the stage-6 MCP server both import
  // lib/services, lib/psi, lib/report and lib/sitemap directly as plain
  // Node/TypeScript. A single `next/*` or `react` import anywhere in that
  // tree breaks both at load time. (lib/queue/ used to be in this list too,
  // before it was deleted entirely -- see docs/DECISIONS.md §11.)
  //
  // If you edit this rule, re-verify it still bites:
  //   echo "import 'next/headers';" >> lib/services/_probe.ts && npm run lint
  // It must FAIL. An unenforced boundary is decorative.
  {
    files: [
      "lib/services/**/*.ts",
      "lib/psi/**/*.ts",
      "lib/report/**/*.ts",
      "lib/sitemap/**/*.ts",
      "lib/tenantDb/**/*.ts",
      "lib/env.ts",
      "lib/db.ts",
      "lib/db/**/*.ts",
      "lib/crypto/**/*.ts",
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
    // Generated Prisma clients (prisma/central, prisma/tenant) -- regenerated
    // by `prisma generate`, same reason node_modules/@prisma/client isn't linted.
    "lib/generated/**",
  ]),
]);

export default eslintConfig;
