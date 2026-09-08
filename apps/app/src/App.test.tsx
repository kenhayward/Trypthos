import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceRef } from "@trypthos/domain";
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
  thinking: false,
  reasoningEffort: "medium" as const,
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

  /// A shell that answers for settings and can push a menu action.
  ///
  /// Settings, About and the release notes are reached ONLY from the menus now - the title bar's
  /// gear and About button went with 0.60.0 - so a test about any of them has to come in the way a
  /// user does.
  function shellWithMenu(): { push: (action: string) => void } {
    const menu: { push: (action: string) => void } = {
      push: () => {
        throw new Error("The window never subscribed to menu actions.");
      },
    };
    window.trypthos = {
      ...browserClient,
      readSettings: async () => ({ ok: true as const, settings: DEFAULT_SETTINGS }),
      writeSettings: async () => {},
      onMenuAction: (listener: (message: { action: string }) => void) => {
        menu.push = (action: string) => listener({ action });
        return () => {};
      },
      onWindowState: () => () => {},
      onCloseRequested: () => () => {},
      setDocumentDirty: async () => {},
    } as unknown as typeof window.trypthos;
    return menu;
  }

  it("shows the build version, which comes from /version.json", async () => {
    const user = userEvent.setup();
    const menu = shellWithMenu();
    render(<App />);

    await act(async () => menu.push("about"));
    expect(await screen.findByText(`Version ${APP_VERSION}`)).toBeDefined();
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);

    await user.click(screen.getByRole("button", { name: "Close settings" }));
  });

  // About is a page of the settings dialog rather than a modal of its own, and Help > About opens it
  // there. One About surface, and nothing that can drift from it.
  it("opens settings on About from the Help menu, and closes it", async () => {
    const user = userEvent.setup();
    const menu = shellWithMenu();
    render(<App />);

    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => menu.push("about"));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "About" })).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Close settings" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens settings on Appearance from the Tools menu", async () => {
    const menu = shellWithMenu();
    render(<App />);

    await act(async () => menu.push("preferences"));
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeDefined();
  });

  /// The release notes, from Help to the window.
  ///
  /// Awaited rather than found straight away: the window is a lazy import, which is what keeps the
  /// release history out of what loads with the app.
  it("opens the release notes from the Help menu, and closes them", async () => {
    const user = userEvent.setup();
    const menu = shellWithMenu();
    render(<App />);

    await act(async () => menu.push("release-notes"));
    expect(await screen.findByRole("dialog", { name: "Release notes" })).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Close release notes" }));
    expect(screen.queryByRole("dialog", { name: "Release notes" })).toBeNull();
  });

  /// Several files open at once, from the tree to the tabs and back.
  ///
  /// The parts are tested on their own; this is the wiring between them, which is the thing that can
  /// be right in every component and still wrong in the window.
  describe("open files", () => {
    function shellWithFiles(overrides: Record<string, unknown> = {}): {
      reads: string[];
      asked: (string | null)[];
      savedAs: { path: string | null; content: string }[];
      menu: { push: ((action: string) => void) | null };
      written: Settings[];
    } {
      const reads: string[] = [];
      const asked: (string | null)[] = [];
      const savedAs: { path: string | null; content: string }[] = [];
      const written: Settings[] = [];
      const menu: { push: ((action: string) => void) | null } = { push: null };
      window.trypthos = {
        ...browserClient,
        isDesktop: true,
        readSettings: async () => ({
          ok: true as const,
          settings: { ...DEFAULT_SETTINGS, workspaces: [{ kind: "local" as const, root: "D:/Notes" }] },
        }),
        writeSettings: async (settings: Settings) => {
          written.push(settings);
        },
        openWorkspaceRef: async (ref: WorkspaceRef) => ({
          ok: true as const,
          // The id the main process mints, from the folder's name. It is the first segment of every
          // path in this workspace.
          workspace: { id: "Notes", name: "Notes", ref },
        }),
        listDirectory: async () => ({
          ok: true as const,
          // Qualified, as the shell answers - the renderer never works out which folder a row is in.
          nodes: [
            { id: "Notes/one.md", name: "one.md", kind: "file" as const },
            { id: "Notes/two.md", name: "two.md", kind: "file" as const },
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
        onMenuAction: (listener: (message: { action: string }) => void) => {
          menu.push = (action: string) => listener({ action });
          return () => {};
        },
        setDocumentDirty: async () => {},
        // The dialog is the shell's, so the fake stands in for the whole of it - what comes back is
        // what the user picked. Note there is no destination to pass in.
        saveFileAs: async (workspaceId: string, path: string | null, content: string) => {
          savedAs.push({ path, content });
          return {
            ok: true as const,
            path: `${workspaceId}/elsewhere.md`,
            revision: { id: "r-saved-as" },
          };
        },
        ...overrides,
      } as unknown as typeof window.trypthos;
      return { reads, asked, savedAs, menu, written };
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
      // Qualified, because a path names the folder it is in.
      expect(reads).toEqual(["Notes/one.md", "Notes/two.md"]);
    });

    /// The filter box, from the keystroke to the row.
    ///
    /// The matcher, the walk, the hook and the panel are each tested on their own; this is the
    /// wiring between them, which is what can be right in every part and still wrong in the window.
    /// The file it finds is deliberately one no listing here returns - it comes back from the
    /// SEARCH, which is the whole point of the box.
    it("filters the browser by searching every open folder", async () => {
      const user = userEvent.setup();
      shellWithFiles({
        filterFiles: async () => ({
          ok: true as const,
          paths: ["Notes/deep/buried.md"],
          truncated: false,
        }),
      });
      render(<App />);

      await screen.findByRole("button", { name: /one\.md/ });
      await user.type(screen.getByLabelText("Filter files"), "buried");

      expect(await screen.findByRole("button", { name: /buried\.md/ })).toBeDefined();
      // The folder it is in comes with it, and the files that did not match do not.
      expect(screen.getByText("deep")).toBeDefined();
      expect(screen.queryByRole("button", { name: /one\.md/ })).toBeNull();
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

    /// Save As, from the File menu down to the tab strip.
    ///
    /// The menu item, the shortcut and the shell's dialog are each tested on their own; this is the
    /// wiring, which is what can be right in every part and still wrong in the window.
    it("saves the open document somewhere else, and the tab follows it", async () => {
      const user = userEvent.setup();
      const { savedAs, menu } = shellWithFiles();
      render(<App />);

      await screen.findByRole("button", { name: /one\.md/ });
      await user.click(row("one.md"));
      act(() => menu.push?.("save-as"));

      await waitFor(() =>
        expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["elsewhere.md"]),
      );
      expect(savedAs).toEqual([{ path: "Notes/one.md", content: "# Notes/one.md\n" }]);
    });

    // Ctrl+Shift+S, and it must not be read as Ctrl+S: the two write to different places, and the
    // one that silently overwrote the original would be the expensive mistake.
    it("saves somewhere else from the keyboard, without saving over the original", async () => {
      const user = userEvent.setup();
      const { savedAs } = shellWithFiles();
      render(<App />);

      await screen.findByRole("button", { name: /one\.md/ });
      await user.click(row("one.md"));
      await user.keyboard("{Control>}{Shift>}s{/Shift}{/Control}");

      await waitFor(() => expect(savedAs).toHaveLength(1));
      await waitFor(() =>
        expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["elsewhere.md"]),
      );
    });

    /// The File menu's recent list, from opening a file to what is written down.
    ///
    /// The menu itself is drawn in the main process from these settings, so this is the half the
    /// window owns: an entry naming the folder as well as the file, because a relative path means
    /// nothing without the folder it is relative to.
    it("remembers a file it opened, with the folder it was in", async () => {
      const user = userEvent.setup();
      const { written } = shellWithFiles();
      render(<App />);

      await screen.findByRole("button", { name: /one\.md/ });
      await user.click(row("one.md"));

      await waitFor(() =>
        expect(written.at(-1)?.recentFiles).toEqual([{ root: "D:/Notes", path: "one.md" }]),
      );
    });

    it("clears the list when the menu asks", async () => {
      const user = userEvent.setup();
      const { written, menu } = shellWithFiles();
      render(<App />);

      await screen.findByRole("button", { name: /one\.md/ });
      await user.click(row("one.md"));
      await waitFor(() => expect(written.at(-1)?.recentFiles).toHaveLength(1));

      act(() => menu.push?.("clear-recent"));
      await waitFor(() => expect(written.at(-1)?.recentFiles).toEqual([]));
    });

    // The whole point of the Explorer entries: the shell pushes what it was launched with, and the
    // window opens it. Everything either side of this is tested on its own; this is the wiring.
    it("opens a folder and file it is handed from the shell", async () => {
      let push: ((target: { root: string; file: string | null }) => void) | null = null;
      shellWithFiles();
      window.trypthos = {
        ...window.trypthos,
        onOpenTarget: (listener: (target: { root: string; file: string | null }) => void) => {
          push = listener;
          return () => {};
        },
      } as unknown as typeof window.trypthos;
      render(<App />);

      await screen.findByRole("button", { name: /one\.md/ });
      await act(async () => {
        push!({ root: "D:/Elsewhere", file: "two.md" });
      });

      await waitFor(() =>
        expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["two.md"]),
      );
    });

    /// The Help menu's guide, end to end.
    ///
    /// The shell sends an action, the window opens a document that is not a file, and the document
    /// behaves as one: a tab of its own, named, and refusing everything a save would need.
    it("opens the markdown guide from the Help menu, read-only and never saved", async () => {
      const user = userEvent.setup();
      // The shell pushes a MESSAGE, not a bare name, and the renderer validates it on arrival - so
      // the fake pushes what the preload really sends.
      let choose: ((message: unknown) => void) | null = null;
      const writes: string[] = [];
      shellWithFiles();
      window.trypthos = {
        ...window.trypthos,
        onMenuAction: (listener: (message: unknown) => void) => {
          choose = listener;
          return () => {};
        },
        writeFile: async (path: string) => {
          writes.push(path);
          return { ok: true as const, revision: { id: "r2" } };
        },
      } as unknown as typeof window.trypthos;
      render(<App />);

      await screen.findByRole("button", { name: /one\.md/ });
      await act(async () => {
        choose!({ action: "markdown-guide" });
      });

      const tab = await screen.findByRole("tab", { name: /Markdown Syntax Guide/ });
      expect(tab.getAttribute("aria-selected")).toBe("true");
      expect(screen.getByLabelText("Document source").textContent).toContain(
        "GitHub Flavored Markdown",
      );

      // Ctrl+S is the app's save, bound on the window. The guide has nowhere to be written to, so
      // nothing is written and nothing is said about it.
      await user.keyboard("{Control>}s{/Control}");
      expect(writes).toEqual([]);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    // Invisible when broken: the prompt still appears, and still asks about "this document" - which
    // is the wording that stopped being good enough once more than one file can be unsaved.
    it("names the document in the prompt about unsaved changes", async () => {
      const user = userEvent.setup();
      const { asked } = shellWithFiles();
      render(<App />);

      await screen.findByRole("button", { name: /one\.md/ });
      await user.click(row("one.md"));
      await user.click(screen.getByLabelText("Document source"));
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
      expect(screen.getByLabelText("Document source").textContent).toContain("Scratch buffer");
    });

    // The button, not the state behind it. A Dismiss that does nothing looks exactly like a Dismiss
    // that works until you press it, and no test of the banner's wording would have noticed.
    it("dismisses the banner when a file cannot be opened", async () => {
      const user = userEvent.setup();
      window.trypthos = {
        ...browserClient,
        isDesktop: true,
        readSettings: async () => ({
          ok: true as const,
          settings: { ...DEFAULT_SETTINGS, workspaces: [{ kind: "local" as const, root: "D:/Notes" }] },
        }),
        writeSettings: async () => {},
        openWorkspaceRef: async (ref: WorkspaceRef) => ({
          ok: true as const,
          // The id the main process mints, from the folder's name. It is the first segment of every
          // path in this workspace.
          workspace: { id: "Notes", name: "Notes", ref },
        }),
        listDirectory: async () => ({
          ok: true as const,
          nodes: [{ id: "Notes/gone.md", name: "gone.md", kind: "file" as const }],
        }),
        readFile: async () => ({ ok: false as const, reason: "not-found" }),
      } as unknown as typeof window.trypthos;
      render(<App />);

      await screen.findByRole("button", { name: /gone\.md/ });
      await user.click(row("gone.md"));
      expect(screen.getByRole("alert").textContent).toContain("no longer there");

      await user.click(screen.getByRole("button", { name: "Dismiss" }));

      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
});

/// Slash commands, from typing one to the table it produces.
///
/// The parsing and the tables are tested on their own; this is the wiring, and the one thing that
/// matters most about it: a command must not reach a provider.
describe("slash commands", () => {
  function shellWithChat(): { sent: unknown[] } {
    const sent: unknown[] = [];
    window.trypthos = {
      ...browserClient,
      isDesktop: true,
      readSettings: async () => ({
        ok: true as const,
        settings: { ...DEFAULT_SETTINGS, chat: { ...DEFAULT_SETTINGS.chat, profiles: [PROFILE] } },
      }),
      writeSettings: async () => {},
      sendChat: async (...args: unknown[]) => {
        sent.push(args);
        return { ok: true as const, streamId: "s1" };
      },
      cancelChat: async () => {},
      onChatEvent: () => () => {},
      onWindowState: () => () => {},
      onCloseRequested: () => () => {},
      onMenuAction: () => () => {},
      setDocumentDirty: async () => {},
    } as unknown as typeof window.trypthos;
    return { sent };
  }

  async function ask(question: string) {
    const user = userEvent.setup();
    const box = await screen.findByRole("textbox", { name: "Message" });
    await user.type(box, question);
    await user.click(screen.getByRole("button", { name: "Send" }));
  }

  it("answers /tools without asking a model", async () => {
    const { sent } = shellWithChat();
    render(<App />);

    await ask("/tools");

    expect(await screen.findByText(/Model tools/)).toBeDefined();
    expect(screen.getByText(/get_file_contents/)).toBeDefined();
    expect(sent).toHaveLength(0);
  });

  it("answers /help with the list of commands", async () => {
    shellWithChat();
    render(<App />);

    await ask("/help");

    expect(await screen.findByText(/Commands/)).toBeDefined();
    expect(screen.getByText(/tools/)).toBeDefined();
  });

  // The guard that keeps this from swallowing somebody's question. A leading slash is an ordinary
  // way to start a sentence.
  it("sends a question that merely begins with a slash", async () => {
    const { sent } = shellWithChat();
    render(<App />);

    await ask("/usr/local/bin - what lives there?");

    await waitFor(() => expect(sent).toHaveLength(1));
  });
});

/// File > New, from the menu to a tab with a name and nowhere to be.
describe("making a new file", () => {
  function shell(): { menu: { push: ((action: string) => void) | null }; savedAs: unknown[] } {
    const menu: { push: ((action: string) => void) | null } = { push: null };
    const savedAs: unknown[] = [];
    window.trypthos = {
      ...browserClient,
      isDesktop: true,
      // With a folder open, because a document that has never been saved has to land in one - and
      // with several possible, something has to say which.
      readSettings: async () => ({
        ok: true as const,
        settings: { ...DEFAULT_SETTINGS, workspaces: [{ kind: "local" as const, root: "D:/Notes" }] },
      }),
      writeSettings: async () => {},
      openWorkspaceRef: async (ref: WorkspaceRef) => ({
        ok: true as const,
        workspace: { id: "Notes", name: "Notes", ref },
      }),
      listDirectory: async () => ({ ok: true as const, nodes: [] }),
      onWindowState: () => () => {},
      onCloseRequested: () => () => {},
      onMenuAction: (listener: (message: { action: string }) => void) => {
        menu.push = (action: string) => listener({ action });
        return () => {};
      },
      setDocumentDirty: async () => {},
      saveFileAs: async (workspaceId: string, path: string | null, content: string) => {
        savedAs.push({ path, content });
        return { ok: true as const, path: `${workspaceId}/notes.md`, revision: { id: "r1" } };
      },
    } as unknown as typeof window.trypthos;
    return { menu, savedAs };
  }

  it("opens a tab for a file that does not exist yet", async () => {
    const user = userEvent.setup();
    const { menu } = shell();
    render(<App />);

    await waitFor(() => expect(menu.push).not.toBeNull());
    act(() => menu.push?.("new-file"));

    await user.type(await screen.findByLabelText("Name"), "notes");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("tab", { name: /notes\.md/ })).toBeDefined();
  });

  // The whole point of it being a draft: it has a name and no place, and saving asks for the place.
  it("asks where to put it the first time it is saved", async () => {
    const user = userEvent.setup();
    const { menu, savedAs } = shell();
    render(<App />);

    await waitFor(() => expect(menu.push).not.toBeNull());
    act(() => menu.push?.("new-file"));

    await user.type(await screen.findByLabelText("Name"), "notes");
    await user.click(screen.getByRole("button", { name: "Create" }));
    act(() => menu.push?.("save"));

    // The dialog opens at the name the file was given, not at the identity it holds a tab with.
    await waitFor(() => expect(savedAs).toEqual([{ path: "notes.md", content: "" }]));
  });
});

/// Opening a GitHub repository, through the whole window.
///
/// The picker was reported vanishing on its own while it said it was loading, which no test of the
/// dialog on its own could see: the dialog is mounted by App, and whether it STAYS mounted is App's
/// business rather than the dialog's. That seam is the one thing every other test here fakes away.
describe("opening a GitHub repository", () => {
  const REPOS = [
    {
      owner: "ada",
      name: "notes",
      fullName: "ada/notes",
      private: false,
      defaultBranch: "main",
      description: null,
      pushedAt: null,
    },
  ];

  function shellWithGitHub(overrides: Record<string, unknown> = {}) {
    const opened: unknown[] = [];
    window.trypthos = {
      ...browserClient,
      isDesktop: true,
      readSettings: async () => ({ ok: true as const, settings: DEFAULT_SETTINGS }),
      writeSettings: async () => {},
      listDirectory: async () => ({ ok: true as const, nodes: [] }),
      githubStatus: async () => ({ ok: true as const, connected: true, login: "ada", reason: null }),
      connectGitHub: async () => ({ ok: true as const, login: "ada" }),
      disconnectGitHub: async () => ({ ok: true }),
      listRepositories: async () => ({ ok: true as const, repos: REPOS }),
      openWorkspaceRef: async (ref: unknown) => {
        opened.push(ref);
        return {
          ok: true as const,
          workspace: { id: "notes", name: "notes", ref, truncated: false },
        };
      },
      onWindowState: () => () => {},
      onCloseRequested: () => () => {},
      onMenuAction: () => () => {},
      onOpenTarget: () => () => {},
      ...overrides,
    } as unknown as typeof window.trypthos;
    return { opened };
  }

  it("opens the picker and keeps it open while it loads", async () => {
    shellWithGitHub();
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open GitHub repository" }));

    // The reported failure: it appears, says it is working, and then goes away by itself.
    expect(await screen.findByRole("button", { name: /ada\/notes/ })).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Open a GitHub repository" })).toBeTruthy();
  });

  it("opens the repository that was chosen, and puts it in the browser", async () => {
    const { opened } = shellWithGitHub();
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open GitHub repository" }));
    await user.click(await screen.findByRole("button", { name: /ada\/notes/ }));

    expect(opened).toEqual([{ kind: "github", owner: "ada", repo: "notes" }]);
    // The dialog has done its job and gone, and the repository is a row in the browser.
    expect(screen.queryByRole("dialog", { name: "Open a GitHub repository" })).toBeNull();
    expect(await screen.findByRole("button", { name: "notes" })).toBeTruthy();
  });

  // If opening fails, the user must be told - the dialog has closed by then, so the message has
  // nowhere to live but the window's own banner.
  it("says so in the window when the repository cannot be opened", async () => {
    shellWithGitHub({
      openWorkspaceRef: async () => ({ ok: false as const, reason: "permission-denied" }),
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open GitHub repository" }));
    await user.click(await screen.findByRole("button", { name: /ada\/notes/ }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Trypthos is not allowed to open that.")).toBeTruthy();
  });
});
