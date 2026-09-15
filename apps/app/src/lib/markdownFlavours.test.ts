import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

/// The two flavours Preview renders: GitHub's, and Obsidian's on top of it.
///
/// Asserted against the parsed result rather than the markup's spelling, so a change in attribute
/// order is not a failure - what an element IS, and what it carries, is.

const dom = (html: string) => new DOMParser().parseFromString(html, "text/html").body;
const gfm = (text: string) => dom(renderMarkdown(text));
const obsidian = (text: string) => dom(renderMarkdown(text, { flavour: "obsidian" }));

describe("in both flavours", () => {
  describe("front matter", () => {
    it("is shown as a table of properties, not as a rule and a heading", () => {
      for (const body of [gfm, obsidian].map((render) => render("---\ntitle: Plan\ntags:\n  - a\n  - b\n---\n\n# Plan\n"))) {
        const table = body.querySelector("table.md-properties");
        expect(table).not.toBeNull();
        expect([...table!.querySelectorAll("tr")].map((row) => row.textContent)).toEqual(["titlePlan", "tagsa, b"]);
        expect(body.querySelector("hr")).toBeNull();
        expect(body.querySelector("h1")?.textContent).toBe("Plan");
      }
    });

    it("shows a value as text, never as markup", () => {
      const body = gfm('---\ntitle: <img src=x onerror="alert(1)">\n---\nBody');
      expect(body.querySelector("img")).toBeNull();
      expect(body.querySelector("table.md-properties")?.textContent).toContain("<img src=x");
    });
  });

  describe("footnotes", () => {
    const text = "One claim.[^a] Another.[^b]\n\n[^b]: Second source.\n[^a]: First source.\n";

    it("numbers references in the order they are read and links each to its note", () => {
      for (const body of [gfm(text), obsidian(text)]) {
        const refs = [...body.querySelectorAll("sup.footnote-ref a")];
        expect(refs.map((ref) => ref.textContent)).toEqual(["1", "2"]);
        expect(refs.map((ref) => ref.getAttribute("href"))).toEqual(["#fn-1", "#fn-2"]);
        expect(refs.every((ref) => ref.hasAttribute("data-md-link"))).toBe(true);

        const notes = [...body.querySelectorAll("section.footnotes li")];
        expect(notes.map((note) => note.id)).toEqual(["md-fn-1", "md-fn-2"]);
        expect(notes[0]!.textContent).toContain("First source.");
        expect(notes[1]!.textContent).toContain("Second source.");
        expect(notes[0]!.querySelector("a[data-md-link]")?.getAttribute("href")).toBe("#fnref-1");
      }
    });

    it("leaves a reference to a note nobody wrote as it was typed", () => {
      expect(gfm("A claim.[^missing]").textContent).toContain("[^missing]");
    });
  });

  // GitHub's alerts: the bare marker alone on the first line of a quote.
  describe("GitHub alerts", () => {
    // Obsidian reads IMPORTANT and CAUTION as its own aliases, and styles them as the types they
    // stand for there.
    it.each([
      ["NOTE", "note", "note", "Note"],
      ["tip", "tip", "tip", "Tip"],
      ["IMPORTANT", "important", "tip", "Important"],
      ["WARNING", "warning", "warning", "Warning"],
      ["CAUTION", "caution", "warning", "Caution"],
    ])("renders [!%s] as a callout", (marker, gfmType, obsidianType, title) => {
      const rendered = [
        [gfm(`> [!${marker}]\n> Read this.`), gfmType],
        [obsidian(`> [!${marker}]\n> Read this.`), obsidianType],
      ] as const;
      for (const [body, type] of rendered) {
        const callout = body.querySelector(".callout");
        expect(callout?.getAttribute("data-callout")).toBe(type);
        expect(callout?.querySelector(".callout-title")?.textContent).toBe(title);
        expect(callout?.querySelector(".callout-content")?.textContent?.trim()).toBe("Read this.");
        expect(body.querySelector("blockquote")).toBeNull();
      }
    });
  });

  it("gives headings ids links can reach, unique within the document", () => {
    const body = gfm("# Goals & plans\n\n## Goals & plans\n\n## Café 2");
    expect([...body.querySelectorAll("h1, h2")].map((heading) => heading.id)).toEqual([
      "md-goals--plans",
      "md-goals--plans-1",
      "md-café-2",
    ]);
  });
});

describe("GFM", () => {
  // Obsidian's marks are plain text to GFM, and a GFM document shows them as written.
  it("shows Obsidian's marks as they were typed", () => {
    const body = gfm("See [[Plan]], ==this== and %%that%%. #tag\n\n> [!faq]- Why?\n> Because.");
    expect(body.querySelector("a")).toBeNull();
    expect(body.querySelector("mark")).toBeNull();
    expect(body.querySelector(".callout")).toBeNull();
    expect(body.textContent).toContain("[[Plan]]");
    expect(body.textContent).toContain("==this==");
    expect(body.textContent).toContain("%%that%%");
    expect(body.querySelector("blockquote")?.textContent).toContain("[!faq]- Why?");
  });

  it("joins lines of a paragraph, as GFM does", () => {
    expect(gfm("one\ntwo").querySelector("br")).toBeNull();
  });
});

describe("Obsidian", () => {
  it("breaks a line where the author did, as Obsidian does by default", () => {
    expect(obsidian("one\ntwo").querySelector("p")?.innerHTML).toBe("one<br>two");
  });

  it("highlights ==text==, including what is inside it", () => {
    const mark = obsidian("A ==**very** important== point.").querySelector("mark");
    expect(mark?.innerHTML).toBe("<strong>very</strong> important");
  });

  it("drops comments, inline and block", () => {
    const body = obsidian("Shown %%hidden%% shown.\n\n%%\nAlso hidden\n\nstill hidden\n%%\n\nAfter");
    expect(body.textContent).not.toContain("hidden");
    expect(body.textContent).toContain("Shown  shown.");
    expect(body.textContent).toContain("After");
  });

  describe("callouts", () => {
    it("takes a title, and styles an alias as the type it stands for", () => {
      const callout = obsidian("> [!faq] Why *this*?\n> Because.").querySelector(".callout");
      expect(callout?.getAttribute("data-callout")).toBe("question");
      expect(callout?.querySelector(".callout-title")?.innerHTML).toBe("Why <em>this</em>?");
    });

    it("titles one without a title after the type as written", () => {
      expect(obsidian("> [!todo]\n> Soon.").querySelector(".callout-title")?.textContent).toBe("Todo");
    });

    it("styles a type it does not know as a note, keeping its name", () => {
      const callout = obsidian("> [!recipe]\n> Flour.").querySelector(".callout");
      expect(callout?.getAttribute("data-callout")).toBe("note");
      expect(callout?.querySelector(".callout-title")?.textContent).toBe("Recipe");
    });

    it("folds with - closed and + open", () => {
      const closed = obsidian("> [!tip]- Hidden\n> Inside.").querySelector("details.callout");
      const open = obsidian("> [!tip]+ Shown\n> Inside.").querySelector("details.callout");
      expect(closed?.hasAttribute("open")).toBe(false);
      expect(open?.hasAttribute("open")).toBe(true);
      expect(closed?.querySelector("summary.callout-title")?.textContent).toBe("Hidden");
    });

    it("nests", () => {
      const outer = obsidian("> [!note] Outer\n> Text\n> > [!warning] Inner\n> > Careful.").querySelector(".callout");
      const inner = outer?.querySelector(".callout-content .callout");
      expect(inner?.getAttribute("data-callout")).toBe("warning");
      expect(inner?.textContent).toContain("Careful.");
    });

    it("renders markdown inside", () => {
      const content = obsidian("> [!info]\n> - one\n> - **two**").querySelector(".callout-content");
      expect(content?.querySelectorAll("li")).toHaveLength(2);
      expect(content?.querySelector("strong")?.textContent).toBe("two");
    });
  });

  it("numbers an inline footnote among the others", () => {
    const body = obsidian("First.[^1] Second.^[Inline *note*.]\n\n[^1]: A note.");
    expect([...body.querySelectorAll("sup.footnote-ref a")].map((ref) => ref.textContent)).toEqual(["1", "2"]);
    expect(body.querySelector("#md-fn-2")?.innerHTML).toContain("Inline <em>note</em>.");
  });

  it("hides a block id, leaving a place a link can reach", () => {
    const body = obsidian("Worth quoting. ^quote-1\n\nNext.");
    expect(body.textContent).not.toContain("^quote-1");
    expect(body.querySelector("#md-\\^quote-1")).not.toBeNull();
  });

  it("marks tags, and leaves what only looks like one", () => {
    const body = obsidian("Filed #inbox/to-read and #y1984, not #1984 or page#anchor.");
    expect([...body.querySelectorAll(".md-tag")].map((tag) => tag.textContent)).toEqual(["#inbox/to-read", "#y1984"]);
    expect(body.textContent).toContain("#1984");
    expect(body.textContent).toContain("page#anchor");
  });

  it("ticks a task whose box holds anything but a space", () => {
    const boxes = [...obsidian("- [?] Maybe\n- [-] Dropped\n- [ ] Open").querySelectorAll("input[type=checkbox]")];
    expect(boxes.map((box) => box.hasAttribute("checked"))).toEqual([true, true, false]);
    expect(obsidian("- [?] Maybe").textContent).not.toContain("[?]");
  });

  describe("wiki links", () => {
    it("links a note by name, showing its name", () => {
      const link = obsidian("See [[Plan]].").querySelector("a");
      expect(link?.getAttribute("href")).toBe("Plan.md");
      expect(link?.getAttribute("data-wikilink")).toBe("Plan");
      expect(link?.hasAttribute("data-md-link")).toBe(true);
      expect(link?.textContent).toBe("Plan");
    });

    it("shows an alias, and a heading the way Obsidian does", () => {
      expect(obsidian("[[Plan|the plan]]").querySelector("a")?.textContent).toBe("the plan");
      expect(obsidian("[[Plan#Goals]]").querySelector("a")?.textContent).toBe("Plan > Goals");
    });

    it("links a heading in the same note to its id", () => {
      const link = obsidian("[[#Goals & plans]]").querySelector("a");
      expect(link?.getAttribute("href")).toBe("#goals--plans");
      expect(link?.textContent).toBe("Goals & plans");
    });

    it("works inside a table, where the bar is escaped", () => {
      expect(obsidian("| a |\n|---|\n| [[Plan\\|the plan]] |").querySelector("td a")?.textContent).toBe("the plan");
    });

    it("carries nothing from the link text into markup", () => {
      const body = obsidian('[[<img src=x onerror="alert(1)">]] [[javascript:alert(1)|click]]');
      expect(body.querySelector("img, [onerror]")).toBeNull();
      expect(body.querySelector("a")).toBeNull();
      expect(body.textContent).toContain("click");
    });
  });

  describe("embeds", () => {
    it("shows an image, at the size given", () => {
      const one = obsidian("![[diagram.png|100]]").querySelector("img");
      expect(one?.getAttribute("src")).toBe("diagram.png");
      expect(one?.getAttribute("width")).toBe("100");
      expect(one?.hasAttribute("data-embed")).toBe(true);

      const two = obsidian("![[Folder/diagram.png|100x145]]").querySelector("img");
      expect([two?.getAttribute("width"), two?.getAttribute("height")]).toEqual(["100", "145"]);
    });

    // Showing another note's contents inside this one comes later; until then it is a link to it.
    it("links an embedded note rather than leaving the marks", () => {
      const link = obsidian("![[Plan#Goals]]").querySelector("a.md-embed");
      expect(link?.getAttribute("href")).toBe("Plan.md");
      expect(link?.textContent).toBe("Plan > Goals");
    });
  });

  // Math arrives with a later release. Until then it is the text that was written.
  it("leaves math as written", () => {
    expect(obsidian("$e^{i\\pi}$").textContent).toContain("$e^{i\\pi}$");
  });
});
