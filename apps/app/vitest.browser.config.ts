import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import version from "../../version.json" with { type: "json" };

/// Tests that need a real browser.
///
/// Separate from vitest.config.ts, and separate on purpose. The jsdom suite is fast and runs on every
/// save; this one starts a browser, so it is a different kind of thing to run. Keeping two configs
/// means neither has to compromise: jsdom stays quick, and this one is free to assert things that
/// only exist once text has actually been laid out.
///
/// What belongs here: anything whose correctness is a rendering question. CodeMirror decides what to
/// render by measuring text, and jsdom has no geometry, so Live mode's hidden markers - the whole
/// visible point of the mode - cannot be asserted there at all.
///
/// What does NOT belong here: logic. If a rule can be expressed over data, it is tested in the jsdom
/// suite or as a pure function, because a browser test that fails tells you far less about why.
export default defineConfig({
  resolve: {
    alias: {
      // The renderer uses the domain's SOURCE, not its build output, so a change there hot-reloads
      // like any other file. Node consumers (the Electron shell) resolve package.json main to dist,
      // which is why the package is built at all.
      "@trypthos/domain": fileURLToPath(new URL("../../packages/domain/src/index.ts", import.meta.url)),
    },
  },
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(version.version),
  },
  test: {
    // Same reasoning as the jsdom config: left implicit, vitest has printed nothing a test logged.
    reporters: ["default"],
    include: ["src/**/*.browser.test.tsx"],
    setupFiles: ["./src/browser-setup.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      // Headless everywhere. `npm run test:browser -- --browser.headless=false` to watch one run.
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});
