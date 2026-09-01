import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import version from "../../version.json" with { type: "json" };

// Kept separate from vite.config.ts so the production build does not depend on vitest.
export default defineConfig({
  resolve: {
    alias: {
      // The renderer uses the domain's SOURCE, not its build output, so a change there hot-reloads
      // like any other file. Node consumers (the Electron shell) resolve package.json main to dist,
      // which is why the package is built at all.
      "@trypthos/domain": fileURLToPath(new URL("../../packages/domain/src/index.ts", import.meta.url)),
    },
  },
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version.version),
  },
  test: {
    // Do NOT remove. Left implicit, vitest printed nothing a test logged on Windows while the
    // identical run on Linux printed all of it - so a local run looks pristine while CI drowns.
    reporters: ["default"],
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // A browser test file ends in .test.tsx too, so the include glob above matches it. Without this
    // the jsdom runner picks up the browser suite and fails on the first @vitest/browser import.
    exclude: [...configDefaults.exclude, "**/*.browser.test.tsx"],
  },
});
