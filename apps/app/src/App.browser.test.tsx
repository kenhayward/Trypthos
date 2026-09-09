import { render, screen, waitFor, within } from "@testing-library/react";
import { page, userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceRef } from "@trypthos/domain";
import { DEFAULT_SETTINGS } from "@trypthos/domain";
import App from "./App";
import { browserClient } from "./lib/workspaceClient";

/// The chat thread, scrolled for real.
///
/// Everything else about the panel is a rule over data and belongs in the jsdom suite. This is not:
/// where a thread sits while a reply streams into it is a question about boxes, and jsdom answers
/// zero to every measurement it is asked - a scroll assertion there would be asserting the polyfill.

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

const END = "THE VERY LAST LINE OF THE ANSWER";

/// A reply several screens long, written the way a model writes prose.
const LONG = `${Array.from(
  { length: 40 },
  (_, n) => `Paragraph ${n + 1}. The quick brown fox jumps over the lazy dog, at length.`,
).join("\n\n")}\n\n${END}`;

type Listener = (message: { streamId: string; event: unknown }) => void;

function fakeShell(): { push: (event: unknown) => void } {
  const listeners: Listener[] = [];
  const streamId = "stream-1";

  window.trypthos = {
    ...browserClient,
    isDesktop: true,
    readSettings: async () => ({
      ok: true as const,
      settings: { ...DEFAULT_SETTINGS, chat: { ...DEFAULT_SETTINGS.chat, profiles: [PROFILE] } },
    }),
    writeSettings: async () => {},
    sendChat: async () => ({ ok: true as const, streamId }),
    cancelChat: async () => {},
    onChatEvent: (listener: Listener) => {
      listeners.push(listener);
      return () => {};
    },
    onWindowState: () => () => {},
    onCloseRequested: () => () => {},
    onMenuAction: () => () => {},
    setDocumentDirty: async () => {},
  } as unknown as typeof window.trypthos;

  return {
    push: (event: unknown) => {
      for (const listener of listeners) listener({ streamId, event });
    },
  };
}

afterEach(() => {
  delete window.trypthos;
});

const thread = () => document.querySelector("[data-testid='chat-thread']") as HTMLElement;
const distanceFromBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight;

/// React commits the last of a burst of events after the assertion that waited for its text has
/// already passed, and the effect that moves the thread runs with it. Everything here measures where
/// the thread ENDED UP, so it has to be read after that has happened.
const settled = () => new Promise((resolve) => setTimeout(resolve, 200));

async function open() {
  // A desktop window. The suite's default viewport is 414 wide, at which `resolvePanelWidths` gives
  // the chat panel nothing at all, and every measurement here would be of a panel zero across.
  await page.viewport(1280, 860);
  const shell = fakeShell();

  // A container filling the viewport, because that is what #root is in the real app. Testing
  // library's own container is an unsized div, in which every panel measures zero.
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;inset:0";
  document.body.append(container);
  render(<App />, { container });

  return shell;
}

async function ask(shell: { push: (event: unknown) => void }, question: string) {
  const box = await screen.findByRole("textbox", { name: "Message" });
  // Set through the DOM rather than with userEvent: what this needs is the send click, and a real
  // pointer click is not reliably actionable inside the fixed container.
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(box, question);
  box.dispatchEvent(new Event("input", { bubbles: true }));

  (screen.getByRole("button", { name: "Send" }) as HTMLElement).click();
  // The stream id is only recorded once `sendChat` resolves, and an event carrying an id the hook
  // does not yet know is dropped. Waiting for "Thinking..." is waiting for that.
  await waitFor(() => expect(screen.getByText("Thinking...")).toBeDefined());
}

/// The reply in chunks, as it actually arrives - each one a render, and a chance to move the thread.
function stream(shell: { push: (event: unknown) => void }, text: string) {
  for (const chunk of text.match(/[\s\S]{1,60}/g) ?? []) {
    shell.push({ type: "token", text: chunk });
  }
}

/// Scrolls the thread as a person would, and tells the panel about it.
///
/// The event matters: the panel decides whether to keep following the answer from where the thread
/// actually is, and it only learns that from a scroll.
function scrollTo(top: number) {
  thread().scrollTop = top;
  thread().dispatchEvent(new Event("scroll", { bubbles: false }));
}

describe("a long reply", () => {
  it("follows the answer down as it arrives", async () => {
    const shell = await open();
    await ask(shell, "Explain this");

    stream(shell, LONG);
    shell.push({ type: "end" });
    await waitFor(() => expect(screen.getByText(new RegExp(END))).toBeDefined());
    await settled();

    expect(distanceFromBottom(thread())).toBeLessThanOrEqual(2);
  });

  // The reason this file exists. A thread that jumps to the newest token every time one arrives is a
  // thread you cannot read while it is being written: the answer is all there, and the part you were
  // looking at is snatched away several times a second.
  it("stays where the user put it when they scroll up mid-reply", async () => {
    const shell = await open();
    await ask(shell, "Explain this");

    stream(shell, LONG);
    await waitFor(() => expect(thread().scrollHeight).toBeGreaterThan(thread().clientHeight * 2));
    await settled();

    // Back to the top, as somebody re-reading the beginning of an answer would.
    scrollTo(0);

    stream(shell, "\n\nAnd a good deal more text arriving after they scrolled away.");
    shell.push({ type: "end" });
    await settled();

    expect(thread().scrollTop).toBe(0);
  });

  // Asking is not reading. Somebody who scrolled up and then typed a question wants to see the
  // answer to it, so a question of their own puts the thread back at the bottom.
  it("goes back to the bottom when the user asks something new", async () => {
    const shell = await open();
    await ask(shell, "Explain this");

    stream(shell, LONG);
    shell.push({ type: "end" });
    await waitFor(() => expect(screen.getByText(new RegExp(END))).toBeDefined());
    await settled();

    scrollTo(0);
    await ask(shell, "And another thing");
    await settled();

    expect(distanceFromBottom(thread())).toBeLessThanOrEqual(2);
  });

  // A guard on the shape of the panel rather than on its behaviour: a thread whose scroll range
  // stops short of its own text, or a panel whose bottom is off the screen, would both look to a
  // user exactly like a scrollbar that will not reach the end of the answer.
  it("can be scrolled to its last line, inside a panel that fits the window", async () => {
    const shell = await open();
    await ask(shell, "Explain this");

    stream(shell, LONG);
    shell.push({ type: "end" });
    await waitFor(() => expect(screen.getByText(new RegExp(END))).toBeDefined());
    await settled();

    const box = thread();
    box.scrollTop = box.scrollHeight;

    expect(screen.getByText(new RegExp(END)).getBoundingClientRect().bottom).toBeLessThanOrEqual(
      box.getBoundingClientRect().bottom + 1,
    );
    expect((box.closest("aside") as HTMLElement).getBoundingClientRect().bottom).toBeLessThanOrEqual(
      window.innerHeight + 1,
    );
  });
});

/// Two folders open at once, drawn.
///
/// The whole window, in a real browser, because what is being checked is what a person SEES: two
/// trees with their own roots, a close button on each, and two files with the same name told apart
/// on their tabs. jsdom answers every measurement with zero and has no cascade, so the tab strip's
/// disambiguation and the panel's layout are questions it cannot be asked.
describe("two folders open at once", () => {
  const WORKSPACES = [
    { id: "Notes", name: "Notes", ref: { kind: "local" as const, root: "D:/Notes" }, truncated: false },
    { id: "Work", name: "Work", ref: { kind: "local" as const, root: "D:/Work" }, truncated: false },
  ];

  function twoFolders() {
    const closed: string[] = [];

    window.trypthos = {
      ...browserClient,
      isDesktop: true,
      readSettings: async () => ({
        ok: true as const,
        settings: { ...DEFAULT_SETTINGS, workspaces: WORKSPACES.map((one) => one.ref) },
      }),
      writeSettings: async () => {},
      openWorkspaceRef: async (ref: WorkspaceRef) => ({
        ok: true as const,
        workspace: WORKSPACES.find((one) => one.ref.root === (ref as { root: string }).root)!,
      }),
      // Each folder holds a file with the same name, which is the case that has no answer without
      // the workspace on the front of a path.
      listDirectory: async (path: string) => ({
        ok: true as const,
        nodes: [{ id: `${path}/notes.md`, name: "notes.md", kind: "file" as const }],
      }),
      readFile: async (path: string) => ({
        ok: true as const,
        content: `# ${path}\n`,
        revision: { id: "r1" },
      }),
      closeWorkspace: async (workspaceId: string) => {
        closed.push(workspaceId);
        return { ok: true };
      },
      onWindowState: () => () => {},
      onCloseRequested: () => () => {},
      onMenuAction: () => () => {},
      setDocumentDirty: async () => {},
    } as unknown as typeof window.trypthos;

    return { closed };
  }

  const panel = () => screen.getByRole("complementary", { name: "Workspace" });

  /// Expands both roots so their files are on screen.
  ///
  /// A remembered workspace comes back COLLAPSED, so the panel is not filled with every folder of
  /// every workspace before the reader has asked for anything. These tests are about how two open
  /// folders are drawn once expanded, so they expand first - exactly as a user does.
  async function expandBoth() {
    await waitFor(() => expect(screen.getByRole("button", { name: "Close Notes" })).toBeDefined());
    for (const name of ["Notes", "Work"]) {
      await userEvent.click(within(panel()).getByRole("button", { name }));
    }
  }

  it("draws a row for each folder, with a close button on each", async () => {
    twoFolders();
    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Close Notes" })).toBeDefined());
    expect(screen.getByRole("button", { name: "Close Work" })).toBeDefined();

    // Both roots are on screen, and both are visible boxes rather than merely present.
    for (const name of ["Notes", "Work"]) {
      const row = within(panel()).getByTitle(`D:/${name}`);
      expect(row.getBoundingClientRect().height).toBeGreaterThan(0);
    }
  });

  it("lists both folders' files, each under its own root", async () => {
    twoFolders();
    render(<App />);
    await expandBoth();

    await waitFor(() =>
      expect(within(panel()).getAllByRole("button", { name: /notes\.md/ })).toHaveLength(2),
    );
  });

  /// The case the whole change exists for.
  ///
  /// Two files called `notes.md`, in two folders. Opened one after the other they are two tabs, and
  /// the strip lengthens both labels until they differ - which is where the workspace on the front
  /// of a path earns its keep, because it is the only thing that differs.
  it("opens both files called notes.md, and tells the tabs apart", async () => {
    twoFolders();
    render(<App />);
    await expandBoth();

    const rows = await waitFor(() => {
      const found = within(panel()).getAllByRole("button", { name: /notes\.md/ });
      expect(found).toHaveLength(2);
      return found;
    });

    await userEvent.click(rows[0]!);
    await userEvent.click(rows[1]!);

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Notes/notes.md",
      "Work/notes.md",
    ]);
  });

  /// Collapsing one root, with the other still open beside it.
  ///
  /// The reason it matters is only visible with two: two large trees at once is a lot of rows to
  /// scroll past to reach the second one, and collapsing the first is how you stop scrolling.
  it("collapses one folder and leaves the other listed", async () => {
    twoFolders();
    render(<App />);
    await expandBoth();

    await waitFor(() =>
      expect(within(panel()).getAllByRole("button", { name: /notes\.md/ })).toHaveLength(2),
    );

    const root = (name: string) =>
      within(panel()).getByRole("button", { name: new RegExp(`^${name}$`) });
    expect(root("Notes").getAttribute("aria-expanded")).toBe("true");

    await userEvent.click(root("Notes"));

    await waitFor(() => expect(root("Notes").getAttribute("aria-expanded")).toBe("false"));
    // One file left on screen, in the folder that is still open - and its row is drawn, not merely
    // present.
    const left = within(panel()).getAllByRole("button", { name: /notes\.md/ });
    expect(left).toHaveLength(1);
    expect(left[0]!.getBoundingClientRect().height).toBeGreaterThan(0);
    expect(root("Work").getAttribute("aria-expanded")).toBe("true");
  });

  /// How far in each row sits, measured on screen.
  ///
  /// The indent is the only thing saying what is inside what, and at the first level it once said
  /// the opposite of the truth - a workspace's own folders drawn level with the workspace. Asserted
  /// here as well as in jsdom because it is a question about where boxes actually are.
  it("draws a folder's contents indented from the folder", async () => {
    twoFolders();
    render(<App />);
    await expandBoth();

    const rows = await waitFor(() => {
      const found = within(panel()).getAllByRole("button", { name: /notes\.md/ });
      expect(found).toHaveLength(2);
      return found;
    });

    const root = within(panel()).getByRole("button", { name: /^Notes$/ });
    // The NAME, not the button: the indent is padding inside the row, so every row's box starts at
    // the same x and only what is drawn in it moves.
    const nameOf = (row: Element) => row.querySelector(".truncate")!.getBoundingClientRect().left;

    expect(nameOf(rows[0]!)).toBeGreaterThan(nameOf(root));
  });

  it("closes one folder and leaves the other", async () => {
    const { closed } = twoFolders();
    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Close Notes" })).toBeDefined());
    await userEvent.click(screen.getByRole("button", { name: "Close Notes" }));

    await waitFor(() => expect(closed).toEqual(["Notes"]));
    expect(screen.queryByRole("button", { name: "Close Notes" })).toBeNull();
    expect(screen.getByRole("button", { name: "Close Work" })).toBeDefined();
  });
});

/// The repository picker, measured.
///
/// Reported as "the dialog vanishes, and pressing the button again leaves the app greyed with no
/// dialog" - which says the backdrop is still mounted from the first press while the panel inside it
/// is not being drawn. That is a question about BOXES: whether the panel has a size and whether it is
/// on screen. jsdom answers zero to every measurement it is asked, so it cannot be asked here - it
/// happily reported this dialog as open and correct.
// Enough that the natural height of the list is far taller than any plausible window. That is the
// condition the bug needed: with a short list the panel fits and centres correctly, which is why
// twelve of them passed while a real account's sixty did not.
const REPOS = Array.from({ length: 60 }, (_, at) => ({
  owner: "ada",
  name: `notes-${at}`,
  fullName: `ada/notes-${at}`,
  private: at % 2 === 0,
  defaultBranch: "main",
  description: at % 3 === 0 ? "A repository with a description on it" : null,
  pushedAt: null,
}));

function shell(overrides: Record<string, unknown> = {}) {
  window.trypthos = {
    ...browserClient,
    isDesktop: true,
    readSettings: async () => ({ ok: true as const, settings: DEFAULT_SETTINGS }),
    writeSettings: async () => {},
    listDirectory: async () => ({
      ok: true as const,
      nodes: [{ id: "notes-0/README.md", name: "README.md", kind: "file" as const }],
    }),
    githubStatus: async () => ({ ok: true as const, connected: true, login: "ada", reason: null }),
    connectGitHub: async () => ({ ok: true as const, login: "ada" }),
    disconnectGitHub: async () => ({ ok: true }),
    listRepositories: async () => ({ ok: true as const, repos: REPOS }),
    openWorkspaceRef: async (ref: unknown) => ({
      ok: true as const,
      workspace: { id: "notes-0", name: "notes-0", ref, truncated: false },
    }),
    readFile: async () => ({
      ok: true as const,
      // Long enough that it must scroll rather than stretch the page.
      content: ["# The repository", ...Array.from({ length: 120 }, (_, at) => `Paragraph ${at}.`)].join(
        "\n\n",
      ),
      revision: { id: "b1" },
    }),
    repoInfo: async () => ({
      ok: true as const,
      stats: {
        // A picture and a fork line, because both are drawn above the cards - a header that grew
        // and pushed them off the bottom is exactly what these tests are here to catch.
        owner: {
          login: "ada",
          name: "Ada Lovelace",
          // A data URL, so the picture is really drawn without the suite reaching the network.
          avatarUrl:
            "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' fill='%232e7d6b'/%3E%3C/svg%3E",
        },
        parent: { fullName: "grace/notes", owner: "grace", name: "notes" },
        branches: 9,
        tags: 3,
        divergence: { ahead: 2, behind: 5 },
        fullName: "ada/notes-0",
        description: "A notebook",
        private: false,
        archived: false,
        topics: ["notes"],
        defaultBranch: "main",
        url: "https://github.com/ada/notes-0",
        homepage: null,
        stars: 1234,
        forks: 56,
        issuesAndPullRequests: 7,
        language: "TypeScript",
        license: "MIT",
        pushedAt: "2026-01-02T00:00:00Z",
      },
    }),
    onWindowState: () => () => {},
    onCloseRequested: () => () => {},
    onMenuAction: () => () => {},
    onOpenTarget: () => () => {},
    ...overrides,
  } as unknown as typeof window.trypthos;
}

describe("the GitHub repository picker, on screen", () => {

  /// The panel inside the backdrop - the thing the user says disappears.
  function panelBox() {
    const dialog = document.querySelector('[role="dialog"]');
    const panel = dialog?.firstElementChild;
    return panel === null || panel === undefined ? null : panel.getBoundingClientRect();
  }

  it("draws a panel with a real size, inside the window", async () => {
    shell();
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Open GitHub repository" }));
    await screen.findByRole("button", { name: /ada\/notes-0/ });

    const box = panelBox();
    expect(box).not.toBeNull();
    // The reported symptom, stated as a measurement: a panel with no height is a dialog that is not
    // there, over a backdrop that plainly is.
    expect(box!.height).toBeGreaterThan(80);
    expect(box!.width).toBeGreaterThan(200);
    expect(box!.top).toBeGreaterThanOrEqual(0);
    expect(box!.bottom).toBeLessThanOrEqual(window.innerHeight + 1);
  });

  // The state the second press lands in: nothing fetched yet, one short line of text in the panel.
  it("draws a panel while it is still checking the account", async () => {
    shell({ githubStatus: () => new Promise(() => {}) });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Open GitHub repository" }));
    await screen.findByText("Checking your GitHub account...");

    const box = panelBox();
    expect(box!.height).toBeGreaterThan(80);
    expect(box!.width).toBeGreaterThan(200);
  });

  // A long list must scroll inside the panel rather than push the panel past the window - which
  // would put the Cancel button, and any error message above it, off the bottom of the screen.
  it("keeps the whole panel on screen when there are many repositories", async () => {
    shell();
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Open GitHub repository" }));
    await screen.findByRole("button", { name: /ada\/notes-59/ });

    const box = panelBox();
    // The reported failure, as a measurement. The backdrop covers the window either way - what the
    // user sees as "the dialog vanished" is the panel being centred in a grid row sized to the whole
    // unclipped list, which puts it below the bottom of the screen.
    expect(box!.top).toBeGreaterThanOrEqual(0);
    expect(box!.bottom).toBeLessThanOrEqual(window.innerHeight + 1);
    const cancel = screen.getByRole("button", { name: "Cancel" }).getBoundingClientRect();
    expect(cancel.bottom).toBeLessThanOrEqual(window.innerHeight + 1);
    expect(cancel.height).toBeGreaterThan(0);
  });
});

/// A repository's own page, measured.
///
/// The cards are pinned and the README scrolls under them. That is a question about boxes, and it is
/// the one that went wrong last time a panel was added: jsdom answers zero to every measurement and
/// reported the picker as correct while it was drawn off the bottom of the window.
describe("the repository page, on screen", () => {
  /// Renders the app into a container the size of the window.
  ///
  /// Testing library's own container is an unsized div, in which every panel sizes to its content -
  /// so a page that is meant to scroll inside the window instead stretches it, and the measurement
  /// below would be of the container rather than of the layout. The chat tests above do the same
  /// thing for the same reason.
  async function openPage(height = 860) {
    await page.viewport(1280, height);
    const container = document.createElement("div");
    container.style.cssText = "position:fixed;inset:0";
    document.body.append(container);
    render(<App />, { container });

    await userEvent.click(await screen.findByRole("button", { name: "Open GitHub repository" }));
    await userEvent.click(await screen.findByRole("button", { name: /ada\/notes-0/ }));
    await userEvent.click(await screen.findByRole("button", { name: "notes-0" }));
    await screen.findByText("Stars");
  }

  it("keeps every card inside the window", async () => {
    shell();
    await openPage();

    for (const label of ["Stars", "Forks", "Branches", "Tags", "Language", "Licence", "Last push"]) {
      const card = screen.getByText(label).getBoundingClientRect();
      expect(card.width, `${label} should have a size`).toBeGreaterThan(0);
      expect(card.top, `${label} should be on screen`).toBeGreaterThanOrEqual(0);
      expect(card.bottom, `${label} should be on screen`).toBeLessThanOrEqual(window.innerHeight + 1);
    }
  });

  /// The same question, asked of a window somebody actually has.
  ///
  /// A frameless Trypthos window on a 1080-tall screen gives the page about 700 pixels, and the
  /// header above the cards has grown - an owner, a fork line, a description a size larger. The
  /// picker bug was exactly this shape: content pushed below the bottom of the window, drawn
  /// perfectly, and invisible. A generous viewport is the one that would not have caught it.
  it("keeps every card inside a short window", async () => {
    shell();
    await openPage(700);

    for (const label of ["Stars", "Tags", "Language", "Last push"]) {
      const card = screen.getByText(label).getBoundingClientRect();
      expect(card.width, `${label} should have a size`).toBeGreaterThan(0);
      expect(card.bottom, `${label} should be on screen`).toBeLessThanOrEqual(window.innerHeight + 1);
    }

    // And the window itself has not grown a scrollbar to fit it all in, which is the other way this
    // goes wrong: everything visible, on a page that is taller than the window.
    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(window.innerHeight + 1);
  });

  /// The sentence that says what the repository is FOR.
  ///
  /// It was the smallest text on a page of numbers, which is backwards - the labels are glanced at
  /// and this is read. A size is a rendering question, so it is asked here, of the computed value,
  /// rather than of a class name in a test that would pass for a class that does nothing.
  it("sets the description larger than the labels around it", async () => {
    shell();
    await openPage();

    const size = (element: Element) =>
      Number.parseFloat(window.getComputedStyle(element).fontSize);

    const description = size(screen.getByText("A notebook"));
    expect(description).toBeGreaterThan(size(screen.getByText("Stars")));
    expect(description).toBeGreaterThan(size(screen.getByText(/Default branch/)));
  });

  // The README is the long part. It has to scroll inside the page rather than stretch it, or the
  // cards are pushed off the top and the window grows a scrollbar of its own.
  it("scrolls the README under the cards, rather than stretching the page", async () => {
    shell();
    await openPage();

    const heading = await screen.findByRole("heading", { name: "The repository" });
    // The nearest ancestor that actually scrolls.
    let scroller: HTMLElement | null = heading.parentElement;
    while (scroller !== null && scroller.scrollHeight <= scroller.clientHeight + 1) {
      scroller = scroller.parentElement;
    }

    expect(scroller, "the README should sit in something that scrolls").not.toBeNull();
    expect(scroller!.scrollHeight).toBeGreaterThan(scroller!.clientHeight);

    // The cards stay where they are while the prose moves under them - which is the whole point of
    // pinning them.
    const before = screen.getByText("Stars").getBoundingClientRect().top;
    scroller!.scrollTop = 400;
    expect(screen.getByText("Stars").getBoundingClientRect().top).toBe(before);

    // And the scrolling region ends inside the window rather than running past the bottom of it.
    expect(scroller!.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight + 1);
  });
});

/// The commit dialog, measured.
///
/// A new dialog is exactly the shape of the bug that cost three releases: drawn perfectly, below the
/// bottom of the window, with the backdrop still covering the screen so it reads as having vanished.
/// It is centred the same way the repository picker now is, and this is what says so.
describe("the commit dialog, on screen", () => {
  function panel() {
    const dialog = document.querySelector('[role="dialog"][aria-label="Save to GitHub"]');
    return dialog?.firstElementChild?.getBoundingClientRect() ?? null;
  }

  async function saveARepositoryFile(height: number) {
    await page.viewport(1280, height);
    const container = document.createElement("div");
    container.style.cssText = "position:fixed;inset:0";
    document.body.append(container);
    render(<App />, { container });

    await userEvent.click(await screen.findByRole("button", { name: "Open GitHub repository" }));
    await userEvent.click(await screen.findByRole("button", { name: /ada\/notes-0/ }));
    await userEvent.click(await screen.findByRole("button", { name: "README.md" }));
    await userEvent.keyboard("{Control>}s{/Control}");
    await screen.findByRole("dialog", { name: "Save to GitHub" });
  }

  it("draws the whole dialog inside the window", async () => {
    shell();
    await saveARepositoryFile(860);

    const box = panel();
    expect(box).not.toBeNull();
    expect(box!.height, "a dialog with no height is one that is not there").toBeGreaterThan(80);
    expect(box!.top).toBeGreaterThanOrEqual(0);
    expect(box!.bottom).toBeLessThanOrEqual(window.innerHeight + 1);
  });

  // A short window is where a dialog goes off the bottom, and it is the case a generous viewport
  // would never catch. Commit in particular has to stay reachable: a dialog whose only button is
  // below the screen is a save that cannot be finished or cancelled.
  it("keeps Commit reachable in a short window", async () => {
    shell();
    await saveARepositoryFile(560);

    const commit = screen
      .getByRole("button", { name: "Commit" })
      .getBoundingClientRect();
    expect(commit.height).toBeGreaterThan(0);
    expect(commit.bottom).toBeLessThanOrEqual(window.innerHeight + 1);
    expect(commit.top).toBeGreaterThanOrEqual(0);
  });
});
