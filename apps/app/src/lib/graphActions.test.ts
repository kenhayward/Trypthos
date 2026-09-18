import { describe, expect, it } from "vitest";
import type { GraphSnapshot } from "@trypthos/domain";
import { graphNodeAction } from "./graphActions";

const snapshot = (newNotes: GraphSnapshot["newNotes"]): GraphSnapshot => ({
  workspaceId: "V",
  builtAt: "2026-09-17T10:00:00.000Z",
  unreadable: 0,
  truncated: false,
  newNotes,
  nodes: [
    { id: "V/a/From.md", kind: "note", label: "From", path: "V/a/From.md", degree: 1 },
    { id: "V/pic.png", kind: "attachment", label: "pic.png", path: "V/pic.png", degree: 0 },
    { id: "ghost:plans/risks", kind: "ghost", label: "Plans/Risks", path: null, degree: 1 },
    { id: "tag:x", kind: "tag", label: "#x", path: null, degree: 0 },
  ],
  edges: [{ source: "V/a/From.md", target: "ghost:plans/risks", both: false }],
});

describe("what double-clicking a node does", () => {
  it("opens a note or an attachment by its path", () => {
    const shot = snapshot({ mode: "root" });
    expect(graphNodeAction(shot.nodes[0]!, shot)).toEqual({ kind: "open", path: "V/a/From.md" });
    expect(graphNodeAction(shot.nodes[1]!, shot)).toEqual({ kind: "open", path: "V/pic.png" });
  });

  it("creates a ghost's note where Obsidian would, named by the last part of the link", () => {
    const beside = snapshot({ mode: "current" });
    expect(graphNodeAction(beside.nodes[2]!, beside)).toEqual({ kind: "create", directory: "V/a", name: "Risks" });
    const inbox = snapshot({ mode: "folder", folder: "Inbox" });
    expect(graphNodeAction(inbox.nodes[2]!, inbox)).toEqual({ kind: "create", directory: "V/Inbox", name: "Risks" });
  });

  it("does nothing for a tag", () => {
    const shot = snapshot({ mode: "root" });
    expect(graphNodeAction(shot.nodes[3]!, shot)).toBe(null);
  });
});
