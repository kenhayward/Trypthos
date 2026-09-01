import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/release/**", "**/node_modules/**", "**/coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // The Electron shell is CommonJS on purpose: the main process is small, and CJS keeps the
    // require-time story simple. Its globals differ from the renderer's.
    files: ["apps/desktop/**/*.{js,cjs}"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      // CommonJS is the point of this directory, so the rule that bans require() does not apply here.
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // Node scripts that are ES modules. Kept separate from the CommonJS block above rather than
    // widening its glob: that block sets sourceType "commonjs", which is wrong for these.
    files: ["**/*.mjs"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
);
