import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import version from "../../version.json" with { type: "json" };

// Kept separate from vite.config.ts so the production build does not depend on vitest.
export default defineConfig({
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
  },
});
