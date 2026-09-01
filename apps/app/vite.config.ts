import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import version from "../../version.json" with { type: "json" };

export default defineConfig({
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
