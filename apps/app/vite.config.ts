import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import version from "../../version.json" with { type: "json" };

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
  // Relative, because the packaged shell loads the built app over file://, not from a server.
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(version.version),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
