import { z } from "zod";
import { qualifyPath, splitQualified } from "./qualifiedPath";

/// Where Obsidian creates a new note, read from the vault's `.obsidian/app.json`.
///
/// The file is Obsidian's, not ours, so everything about it is untrusted: an unknown value, a
/// missing folder or a folder that climbs out of the vault all mean the vault root.

export type NewNoteLocation = { mode: "root" } | { mode: "folder"; folder: string } | { mode: "current" };

export const OBSIDIAN_APP_CONFIG = ".obsidian/app.json";

const AppConfig = z.object({
  newFileLocation: z.enum(["root", "current", "folder"]).optional(),
  newFileFolderPath: z.string().optional(),
});

export function newNoteLocationFrom(raw: unknown): NewNoteLocation {
  const parsed = AppConfig.safeParse(raw);
  if (!parsed.success) return { mode: "root" };
  const { newFileLocation, newFileFolderPath } = parsed.data;
  if (newFileLocation === "current") return { mode: "current" };
  if (newFileLocation !== "folder" || newFileFolderPath === undefined) return { mode: "root" };
  if (newFileFolderPath.startsWith("//") || newFileFolderPath.startsWith("\\\\")) return { mode: "root" };
  const segments = newFileFolderPath.split(/[\\/]/).filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0 || segments.includes("..")) return { mode: "root" };
  const first = segments[0]!;
  if (/^[A-Za-z]:$/.test(first) || first.includes(":")) return { mode: "root" };
  return { mode: "folder", folder: segments.join("/") };
}

export function newNoteDirectory(location: NewNoteLocation, workspaceId: string, linkingNote: string | null): string {
  if (location.mode === "folder") return qualifyPath(workspaceId, location.folder);
  if (location.mode === "current" && linkingNote !== null) {
    const split = splitQualified(linkingNote);
    if (split !== null && split.workspaceId === workspaceId) {
      return qualifyPath(workspaceId, split.path.slice(0, Math.max(split.path.lastIndexOf("/"), 0)));
    }
  }
  return workspaceId;
}
