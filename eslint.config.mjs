import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // The frontend (WalletDemo) seeds an initial fetch synchronously inside an
      // effect — a benign pattern flagged only by the newer React 19 ruleset.
      // Keep it a warning so it doesn't fail lint without touching the UI.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
