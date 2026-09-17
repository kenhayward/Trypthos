import { describe, expect, it } from "vitest";
import { GRAPH_PAGE_PREFIX, graphPagePath, graphPageWorkspaceId, isGraphPagePath } from "./graphPage";
import { splitQualified } from "./qualifiedPath";

describe("the path a vault graph is a tab under", () => {
  it("is built from the workspace it belongs to", () => {
    expect(graphPagePath("Notes")).toBe(`${GRAPH_PAGE_PREFIX}Notes`);
    expect(graphPageWorkspaceId(graphPagePath("Notes"))).toBe("Notes");
    expect(isGraphPagePath(graphPagePath("Notes"))).toBe(true);
  });

  it("answers null for anything that is not one", () => {
    expect(graphPageWorkspaceId("Notes/graph.md")).toBe(null);
    expect(graphPageWorkspaceId("trypthos:repo/Notes")).toBe(null);
    expect(graphPageWorkspaceId(GRAPH_PAGE_PREFIX)).toBe(null);
  });

  it("can never be resolved against a provider", () => {
    expect(splitQualified(graphPagePath("Notes"))).toBe(null);
  });
});
