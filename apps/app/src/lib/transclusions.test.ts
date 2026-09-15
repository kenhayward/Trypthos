import { describe, expect, it, vi } from "vitest";
import { renderMarkdown } from "./markdown";
import { renderTransclusions, type TransclusionDeps } from "./transclusions";

/// Another note's contents shown where `![[Note]]` is written.
///
/// Rendered markdown holds a placeholder with a link to the note; this reads the note and puts what
/// the embed names in its place. Found by name like a wiki link, and never followed round in a
/// circle - a note that embeds itself, or two that embed each other, would otherwise never finish.

const NOTES: Record<string, string> = {
  "Notes/Plan.md": "# Plan\n\nIntro.\n\n## Goals\n\nShip it. ^goal\n\n## Risks\n\nLate.",
  "Notes/A.md": "A says hello.\n\n![[B]]",
  "Notes/B.md": "B says hello.\n\n![[A]]",
  "Notes/deep/One.md": "One ![[Two]]",
  "Notes/deep/Two.md": "Two ![[Three]]",
  "Notes/deep/Three.md": "Three ![[Four]]",
  "Notes/deep/Four.md": "Four",
  "Notes/pictures/Gallery.md": "![[chart.png]]\n\n![](local.png)",
  "Notes/Unsafe.md": '<script>alert(1)</script><img src="x" onerror="alert(1)">Kept.',
};

function deps(overrides: Partial<TransclusionDeps> = {}): TransclusionDeps {
  return {
    fromPath: "Notes/today.md",
    workspaceId: null,
    fileTypes: ["markdown"],
    findByName: vi.fn(async (name: string) =>
      Object.keys(NOTES).filter((path) => path.toLowerCase().endsWith(`/${name.toLowerCase()}`)),
    ),
    readDocument: vi.fn(async (path: string) => NOTES[path] ?? null),
    ...overrides,
  };
}

function rendered(markdown: string): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = renderMarkdown(markdown, { flavour: "obsidian" });
  document.body.append(element);
  return element;
}

const never = () => false;

describe("renderTransclusions", () => {
  it("shows the whole note it names, under a link to it", async () => {
    const element = rendered("Before\n\n![[Plan]]\n\nAfter");

    await renderTransclusions(element, never, deps());

    const embed = element.querySelector(".md-transclusion")!;
    expect(embed.getAttribute("data-tp-embedded")).toBe("done");
    expect(embed.querySelector("a.md-embed")?.textContent).toBe("Plan");
    const body = embed.querySelector(".md-transclusion-body")!;
    expect(body.querySelector("h1")?.textContent).toBe("Plan");
    expect(body.textContent).toContain("Late.");
  });

  it("shows only the heading it names", async () => {
    const element = rendered("![[Plan#Goals]]");

    await renderTransclusions(element, never, deps());

    const body = element.querySelector(".md-transclusion-body")!;
    expect(body.querySelector("h2")?.textContent).toBe("Goals");
    expect(body.textContent).not.toContain("Intro.");
    expect(body.textContent).not.toContain("Late.");
  });

  it("shows only the block it names", async () => {
    const element = rendered("![[Plan#^goal]]");

    await renderTransclusions(element, never, deps());

    expect(element.querySelector(".md-transclusion-body")?.textContent?.trim()).toBe("Ship it.");
  });

  it("leaves the link where the note cannot be found", async () => {
    const element = rendered("![[Nowhere]]");

    await renderTransclusions(element, never, deps());

    const embed = element.querySelector(".md-transclusion")!;
    expect(embed.getAttribute("data-tp-embedded")).toBe("missing");
    expect(embed.querySelector("a.md-embed")).not.toBeNull();
    expect(embed.querySelector(".md-transclusion-body")).toBeNull();
  });

  it("follows embeds inside embeds, and stops when it comes back round", async () => {
    const element = rendered("![[A]]");

    await renderTransclusions(element, never, deps());

    expect(element.textContent).toContain("A says hello.");
    expect(element.textContent).toContain("B says hello.");
    const repeats = [...element.querySelectorAll(".md-transclusion")].filter(
      (embed) => embed.getAttribute("data-tp-embedded") === "cycle",
    );
    expect(repeats).toHaveLength(1);
    expect(element.textContent?.match(/A says hello\./g)).toHaveLength(1);
  });

  // A note embedding itself is the shortest circle there is.
  it("does not embed the document it is in", async () => {
    const element = rendered("![[today]]");

    await renderTransclusions(element, never, deps({ readDocument: vi.fn(async () => "Today ![[today]]"), findByName: vi.fn(async () => ["Notes/today.md"]) }));

    expect(element.querySelector(".md-transclusion")?.getAttribute("data-tp-embedded")).toBe("cycle");
  });

  it("goes no deeper than three notes", async () => {
    const element = rendered("![[One]]");

    await renderTransclusions(element, never, deps());

    expect(element.querySelector('[data-embed-path="Notes/deep/Three.md"]')).not.toBeNull();
    // Four is left as the link to it, and its contents are not read in.
    expect(element.querySelector('[data-embed-path="Notes/deep/Four.md"]')).toBeNull();
    expect([...element.querySelectorAll('[data-tp-embedded="too-deep"]')]).toHaveLength(1);
  });

  it("reads pictures in an embedded note relative to that note", async () => {
    const readImage = vi.fn(async (path: string) =>
      path === "Notes/pictures/local.png" || path === "Notes/attachments/chart.png"
        ? { ok: true as const, dataUrl: `data:image/png;base64,${path}` }
        : { ok: false as const, reason: "not-found" },
    );
    const element = rendered("![[Gallery]]");

    await renderTransclusions(
      element,
      never,
      deps({
        readImage,
        findByName: vi.fn(async (name: string) =>
          name === "chart.png" ? ["Notes/attachments/chart.png"] : ["Notes/pictures/Gallery.md"],
        ),
      }),
    );

    const sources = [...element.querySelectorAll(".md-transclusion-body img")].map((image) => image.getAttribute("src"));
    expect(sources).toEqual(["data:image/png;base64,Notes/attachments/chart.png", "data:image/png;base64,Notes/pictures/local.png"]);
  });

  it("sanitises what it puts in place", async () => {
    const element = rendered("![[Unsafe]]");

    await renderTransclusions(element, never, deps());

    expect(element.querySelector("script, [onerror]")).toBeNull();
    expect(element.textContent).toContain("Kept.");
  });

  it("writes nothing into a document that has been replaced meanwhile", async () => {
    const element = rendered("![[Plan]]");

    await renderTransclusions(element, () => true, deps());

    expect(element.querySelector(".md-transclusion-body")).toBeNull();
  });
});
