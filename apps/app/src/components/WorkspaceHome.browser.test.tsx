import { render, waitFor } from "@testing-library/react";
import { page } from "@vitest/browser/context";
import { describe, expect, it } from "vitest";
import { homeProps } from "../testing/workspaceHomeProps";
import WorkspaceHome from "./WorkspaceHome";

/// The home page's layout, measured.
///
/// Both claims are about boxes, which jsdom reports as zero: that the heading stays put while the
/// README scrolls beneath it, and that the graph is given every pixel below the heading. The second
/// is the one the layout exists for - a graph canvas wants height, and a section that sized to its
/// content would hand it none.

const HEIGHT = 600;

const LONG = Array.from({ length: 80 }, (_, n) => `Paragraph ${n + 1} of a long README, long enough to scroll.`).join(
  "\n\n",
);

async function mount() {
  await page.viewport(900, HEIGHT);
  // A container filling the viewport, as the editor's slot is in the app. Testing library's own
  // container is an unsized div, in which every section measures zero.
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0";
  document.body.append(host);
  const { props } = homeProps({ readme: { loading: false, source: LONG, path: "Notes/README.md", failed: false } });
  return render(<WorkspaceHome {...props} />, { container: host });
}

describe("a workspace's home page, laid out", () => {
  it("gives the graph every pixel below the heading", async () => {
    const view = await mount();
    const graph = await view.findByTestId("graph-section");
    const header = view.container.querySelector("header")!.getBoundingClientRect();
    const box = graph.getBoundingClientRect();

    expect(Math.round(box.top)).toBe(Math.round(header.bottom));
    expect(Math.round(box.bottom)).toBe(HEIGHT);
  });

  it("keeps the heading still while the README scrolls beneath it", async () => {
    const view = await mount();
    (await view.findByRole("tab", { name: "Readme" })).click();
    const heading = await view.findByRole("heading", { name: "Notes", level: 2 });
    const before = heading.getBoundingClientRect().top;

    const scroller = await waitFor(() => {
      const found = view.container.querySelector(".markdown-body")?.parentElement ?? null;
      expect(found).not.toBe(null);
      expect(found!.scrollHeight).toBeGreaterThan(found!.clientHeight);
      return found!;
    });
    scroller.scrollTop = 400;

    expect(scroller.scrollTop).toBeGreaterThan(0);
    expect(heading.getBoundingClientRect().top).toBe(before);
  });
});
