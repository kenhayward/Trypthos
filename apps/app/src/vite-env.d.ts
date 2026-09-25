/// <reference types="vite/client" />

/// Injected at build time from /version.json by vite.config.ts and vitest.config.ts.
declare const __APP_VERSION__: string;

/// The GitHub-flavoured tables, strikethrough and task lists for Turndown. The package ships no
/// types of its own; this is the one export Paste as markdown uses.
declare module "@joplin/turndown-plugin-gfm" {
  import type TurndownService from "turndown";
  export const gfm: TurndownService.Plugin;
}
