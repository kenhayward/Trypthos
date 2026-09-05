import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "@trypthos/domain";
import App from "./App";
import { APP_VERSION } from "./lib/appInfo";
import { browserClient } from "./lib/workspaceClient";

const PROFILE = {
  id: "one",
  label: "Local model",
  endpoint: "http://localhost:11434/v1",
  model: "qwen2.5-coder",
  contextWindow: null,
  supportsImages: false,
  supportsTools: false,
  isDefault: true,
};

/// A shell that answers for settings and nothing else.
///
/// Every other half of the bridge asks for a method of its own before it will build, so this leaves
/// chat, keys and history exactly as the browser preview has them - which is all these need. The
/// workspace calls come from the browser client, which answers "not-desktop" rather than throwing.
function shellWithSettings(settings: Settings): void {
  window.trypthos = {
    ...browserClient,
    readSettings: async () => ({ ok: true as const, settings }),
    writeSettings: async () => {},
  } as unknown as typeof window.trypthos;
}

afterEach(() => {
  delete window.trypthos;
});

describe("App", () => {
  // The chat panel is not among them until a model is configured: with none, it could only tell the
  // user to go and configure one, and the way to do that is Settings.
  it("renders the workspace and the editor", () => {
    render(<App />);
    expect(screen.getByRole("complementary", { name: "Workspace" })).toBeDefined();
    expect(screen.getByRole("main", { name: "Editor" })).toBeDefined();
  });

  it("leaves the chat panel out until a model is configured", () => {
    render(<App />);
    expect(screen.queryByRole("complementary", { name: "Chat" })).toBeNull();
    // Not collapsed either. A rail is a panel someone hid, and this one was never there.
    expect(screen.queryByRole("button", { name: "Show the chat panel" })).toBeNull();
  });

  it("renders all three panels once a model is configured", async () => {
    shellWithSettings({
      ...DEFAULT_SETTINGS,
      chat: { ...DEFAULT_SETTINGS.chat, profiles: [PROFILE] },
    });
    render(<App />);

    expect(await screen.findByRole("complementary", { name: "Chat" })).toBeDefined();
    expect(screen.getByRole("complementary", { name: "Workspace" })).toBeDefined();
    expect(screen.getByRole("main", { name: "Editor" })).toBeDefined();
  });

  // An explicit no wins over a configured model: somebody who wants a plain editor means it.
  it("leaves the chat panel out when it has been switched off", async () => {
    shellWithSettings({
      ...DEFAULT_SETTINGS,
      chat: { ...DEFAULT_SETTINGS.chat, profiles: [PROFILE], showPanel: false },
    });
    render(<App />);

    expect(await screen.findByRole("main", { name: "Editor" })).toBeDefined();
    expect(screen.queryByRole("complementary", { name: "Chat" })).toBeNull();
  });

  // The wiring, end to end: rendered markdown, a real click, and the shell asked to open the link
  // rather than the window loading it. The rule itself is proved in `markdownLinks.test.ts`; what
  // this catches is the handler being off the tree, which no unit test can see.
  describe("links in rendered markdown", () => {
    it("asks the shell to open a web address rather than navigating the window", async () => {
      const opened: string[] = [];
      window.trypthos = {
        ...browserClient,
        readSettings: async () => ({ ok: true as const, settings: DEFAULT_SETTINGS }),
        writeSettings: async () => {},
        openExternal: async (url: string) => {
          opened.push(url);
        },
      } as unknown as typeof window.trypthos;

      render(<App />);
      await userEvent.click(screen.getByRole("button", { name: "Preview" }));

      const link = screen.getByRole("link", { name: "link" });
      // The hover readout, which is how a file in the folder is told from a web address before it is
      // clicked.
      expect(link.getAttribute("title")).toBe("https://example.com");

      await userEvent.click(link);
      expect(opened).toEqual(["https://example.com"]);
    });
  });

  it("shows the build version, which comes from /version.json", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: `About ${APP_VERSION}` })).toBeDefined();
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  // About is a page of the settings dialog rather than a modal of its own, so the title bar opens
  // settings there. One About surface, and nothing that can drift from it.
  it("opens settings on About, and closes it", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByRole("dialog")).toBeNull();

    // Resolve the element first, then act on it. Awaiting a query inside an act scope is what
    // provokes React's "not configured to support act" warning, which test-setup turns into a failure.
    await user.click(screen.getByRole("button", { name: `About ${APP_VERSION}` }));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "About" })).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Close settings" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Two entry points, one dialog: the gear opens the settings themselves rather than About.
  it("opens settings on Appearance from the title bar", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeDefined();
  });

  /// Several files open at once, from the tree to the tabs and back.
  ///
  /// The parts are tested on their own; this is the wiring between them, which is the thing that can
  /// be right in every component and still wrong in the window.
  describe("open files", () => {
    function shellWithFiles(): { reads: string[]; asked: (string | null)[] } {
      const reads: string[] = [];
      const asked: (string | null)[] = [];
      window.trypthos = {
        ...browserClient,
        isDesktop: true,
        readSettings: async () => ({
          ok: true as const,
          settings: { ...DEFAULT_SETTINGS, lastWorkspace: "D:/Notes" },
        }),
        writeSettings: async () => {},
        reopenWorkspace: async (root: string) => ({
          ok: true as const,
          workspace: { root, name: "Notes" },
        }),
        listDirectory: async () => ({
          ok: true as const,
          nodes: [
            { id: "one.md", name: "one.md", kind: "file" as const },
            { id: "two.md", name: "two.md", kind: "file" as const },
          ],
        }),
        readFile: async (path: string) => {
          reads.push(path);
          return { ok: true as const, content: `# ${path}\n`, revision: { id: "r1" } };
        },
        // The prompt lives in the shell, and this is the message it is given.
        confirmDiscard: async (name: string | null) => {
          asked.push(name);
          return { ok: true as const, choice: "discard" as const };
        },
        // Present so the window half of the bridge is taken to exist at all: without it the renderer
        // uses its browser fallbacks, which ask nobody anything.
        onWindowState: () => () => {},
        onCloseRequested: () => () => {},
        onMenuAction: () => () => {},
        setDocumentDirty: async () => {},
      } as unknown as typeof window.trypthos;
      return { reads, asked };
    }

    /// A row in the TREE, not a tab - the file name appears in both, and the close button on a tab
    /// carries it too.
    const row = (name: string) =>
      within(screen.getByRole("complementary", { name: "Workspace" })).getByRole("button", {
        name: new RegExp(name),
      });

    it("opens each file in its own tab, and goes back to one without reading it again", async () => {
      const user = userEvent.setup();
      const { reads } = shellWithFiles();
      render(<App />);

      await screen.findByRole("button", { name: /one\.md/ });
      await user.click(row("one.md"));
      await user.click(row("two.md"));

      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
        "one.md",
        "two.md",
      ]);

      await user.click(screen.getByRole("tab", { name: /one\.md/ }));
      expect(screen.getByRole("tab", { name: /one\.md/ }).getAttribute("aria-selected")).toBe(
        "true",
      );
      // Clicking the file in the TREE is the same act: it goes to the tab that is already open, and
      // reads nothing, because what is on disk would replace what the user has typed.
      await user.click(row("two.md"));
      expect(reads).toEqual(["one.md", "two.md"]);
    });

    // Bound on the window rather than inside the strip, so it works wherever the caret is - which is
    // in the document, essentially always.
    it("closes the document you are in with the keyboard", async () => {
      const user = userEvent.setup();
      shellWithFiles();
      render(<App />);

      await screen.findByRole("button", { name: /one\.md/ });
      await user.click(row("one.md"));
      await user.click(row("two.md"));
      await user.keyboard("{Control>}w{/Control}");

      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["one.md"]);
    });

    // Invisible when broken: the prompt still appears, and still asks about "this document" - which
    // is the wording that stopped being good enough once more than one file can be unsaved.
    it("names the document in the prompt about unsaved changes", async () => {
      const user = userEvent.setup();
      const { asked } = shellWithFiles();
      render(<App />);

      await screen.findByRole("button", { name: /one\.md/ });
      await user.click(row("one.md"));
      await user.click(screen.getByLabelText("Markdown source"));
      await user.keyboard("X");
      await user.click(screen.getByRole("button", { name: "Close one.md" }));

      expect(asked).toEqual(["one.md"]);
    });

    it("closes a tab from the strip", async () => {
      const user = userEvent.setup();
      shellWithFiles();
      render(<App />);

      await screen.findByRole("button", { name: /one\.md/ });
      await user.click(row("one.md"));
      await user.click(screen.getByRole("button", { name: "Close one.md" }));

      expect(screen.queryAllByRole("tab")).toHaveLength(0);
      // Back to the buffer that was there before any file was opened, rather than an empty editor.
      expect(screen.getByLabelText("Markdown source").textContent).toContain("Scratch buffer");
    });
  });
});
