import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pinned explicitly. Left implicit, vitest has printed nothing a test logged on Windows while
    // the identical run on Linux printed all of it - a silent local run is the failure mode here.
    reporters: ["default"],
    include: ["src/**/*.test.ts"],
  },
});
