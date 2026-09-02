import { z } from "zod";
import { SettingsSchema } from "./settings";

/// The IPC contract between the renderer and the shell.
///
/// Shared so both sides are described once. The renderer is untrusted, so the main process parses
/// every argument with these schemas before acting - the renderer having already checked is not a
/// check, and a compromised or buggy renderer is exactly the case this defends against.
///
/// Every schema is `.strict()`. An unexpected field is a sign that the two sides disagree about the
/// contract, and failing loudly the first time beats silently dropping it and diverging further.

/// The complete list of channels. The preload bridge exposes these by name and nothing else: there is
/// deliberately no general "invoke any channel" helper, because one would make this enumeration
/// decorative - anything the main process can do would become reachable from a page.
export const IPC_CHANNELS = [
  "workspace:open",
  "workspace:list",
  "file:read",
  "file:write",
  "window:minimize",
  "window:toggleMaximize",
  "window:close",
  "settings:read",
  "settings:write",
  "workspace:reopen",
] as const;

/// Pushed from the main process when the window is maximised or restored, so the maximise button can
/// show the right glyph. The only channel that flows main to renderer.
///
/// Validated on arrival like everything else. Main is trusted, but the schema is what stops the two
/// sides drifting silently: a shape change here would otherwise surface as a button that stops
/// updating rather than as an error.
export const WINDOW_STATE_CHANNEL = "window:state";

export const WindowStateSchema = z.object({ maximized: z.boolean() }).strict();

export type WindowState = z.infer<typeof WindowStateSchema>;

export type IpcChannel = (typeof IPC_CHANNELS)[number];

/// A provider version token. Opaque: a local mtime and size today, an ETag or commit SHA later.
export const RevisionSchema = z.object({ id: z.string().min(1) }).strict();

/// Workspace-relative. Never absolute - the shell resolves it against the open root and rejects
/// anything that escapes, so a path arriving here is a request, not a location.
const relativePath = z.string();

export const ListRequest = z.object({ path: relativePath }).strict();

export const ReadRequest = z.object({ path: relativePath.min(1) }).strict();

export const WriteRequest = z
  .object({
    path: relativePath.min(1),
    content: z.string(),
    /// The revision the caller last saw, or null to create a new file.
    ///
    /// Required, and explicitly nullable rather than optional. A missing field would read as
    /// "overwrite whatever is there", which is the precise accident the revision exists to prevent -
    /// so creating a file has to say so.
    expectedRevision: RevisionSchema.nullable(),
  })
  .strict();

/// The whole settings object, validated on the way in. The renderer is untrusted like any other
/// caller, and a malformed write would be persisted and then read back on every launch.
export const WriteSettingsRequest = SettingsSchema;

export type ListRequest = z.infer<typeof ListRequest>;
export type ReadRequest = z.infer<typeof ReadRequest>;
export type WriteRequest = z.infer<typeof WriteRequest>;

// No `Revision` type is exported here on purpose: provider.ts already defines it, and a second
// declaration of the same concept is the start of the two drifting apart. RevisionSchema is the
// runtime check for that same shape.
