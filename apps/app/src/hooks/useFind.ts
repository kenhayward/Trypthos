import { useCallback, useRef, useState } from "react";
import {
  findMatches,
  searchScopeFolder,
  type FileHit,
  type FindMatch,
  type FindRequest,
} from "@trypthos/domain";
import { stepIndex, type FindStep } from "../lib/findNavigation";
import type { FindResult } from "../lib/workspaceClient";

export type FindTab = "document" | "files";

/// What the dialog shows about the last search.
///
/// A union rather than a bag of flags, because the states are genuinely exclusive and each says a
/// different thing: `bad-pattern` means retype the expression, an empty `results` means the text is
/// not there, and `failed` means the search never ran.
export type FindStatus =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "bad-pattern" }
  | { kind: "failed" }
  | {
      kind: "results";
      total: number;
      /// One-based, and 0 for "none of them" - it is read out to a person, not used as an index.
      current: number;
      /// True when the search stopped at its budget. An answer cut short has to say so.
      capped: boolean;
    };

/// What the editor should be highlighting, and in which document.
///
/// The path travels with the matches so a highlight cannot end up painted over another file's text:
/// the offsets came from one document, and only that document should wear them.
export interface FindHighlight {
  path: string | null;
  matches: readonly FindMatch[];
  active: number;
}

const NOTHING: FindHighlight = { path: null, matches: [], active: -1 };

/// What the find needs from the window around it.
///
/// Passed in rather than reached for, so the hook can be tested without a workspace, a shell or an
/// editor - and so the two searches sit side by side here rather than half in a component.
export interface FindSurroundings {
  /// The text of the document on screen.
  content: string;
  activePath: string | null;
  /// The folder selected in the browser. "" is no selection - see `searchScopeFolder`.
  selectedFolder: string;
  /// The file types the user has turned on. A search must not read what the browser will not list.
  fileTypes: readonly string[];
  findInFiles: (request: FindRequest) => Promise<FindResult>;
  /// Puts a file on screen. The same act as clicking it in the tree, so a file already open is
  /// switched to rather than read again.
  openPath: (path: string) => Promise<void>;
}

/// Find, and Find in Files.
///
/// Both searches live here rather than in the dialog, because they differ in almost everything -
/// one matches a string this process already holds, the other asks the shell to walk a tree - and
/// what they have in common is exactly what a dialog needs: a query, a list, and a place in it.
///
/// **The highlight is a value, not a call into the editor.** It is handed down as a prop and applied
/// by `DocumentEditor` once the document it names is on screen. Dispatching into the editor from
/// here would race the file being opened: a Find in Files hit arrives before the document does, and
/// the swap that follows would map the highlight through a change that replaced every character.
export function useFind(where: FindSurroundings) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<FindTab>("document");
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [status, setStatus] = useState<FindStatus>({ kind: "idle" });
  const [highlight, setHighlight] = useState<FindHighlight>(NOTHING);

  /// The matches of the last search, and what walking them means.
  ///
  /// A ref rather than state: `step` reads it and writes the highlight, and nothing renders from it
  /// directly - the status line renders from `status`. Held as one object so a search that replaces
  /// both halves cannot leave a stale index pointing into a new list.
  const found = useRef<
    | { kind: "document"; path: string | null; matches: readonly FindMatch[] }
    | { kind: "files"; hits: readonly FileHit[] }
  >({ kind: "document", path: null, matches: [] });
  const at = useRef(-1);

  /// The folder Find in Files would look in, so the dialog can say which before it runs.
  const scope = searchScopeFolder({
    selectedFolder: where.selectedFolder,
    activePath: where.activePath,
  });

  const report = (total: number, current: number, capped: boolean) =>
    setStatus({ kind: "results", total, current: current + 1, capped });

  /// Puts the reader on one of the results.
  ///
  /// The two tabs differ in what that costs: within a document it is a highlight, and across files
  /// it is opening the file first. Both end the same way, with one value saying what to highlight.
  const goTo = useCallback(
    async (index: number) => {
      const list = found.current;
      at.current = index;

      if (list.kind === "document") {
        setHighlight({ path: list.path, matches: list.matches, active: index });
        report(list.matches.length, index, false);
        return;
      }

      const hit = list.hits[index];
      if (hit === undefined) {
        setHighlight(NOTHING);
        return;
      }

      // Awaited, so the highlight is set only once the file is actually open. It is applied by the
      // editor when the document it names is the one on screen, so the order is not load-bearing -
      // but a highlight for a file that failed to open would be one nothing ever clears.
      await where.openPath(hit.path);
      setHighlight({ path: hit.path, matches: [{ from: hit.from, to: hit.to }], active: 0 });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [where.openPath],
  );

  const searchDocument = useCallback(() => {
    const matches = findMatches(where.content, query, { regex });
    if (matches === null) {
      setStatus({ kind: "bad-pattern" });
      setHighlight(NOTHING);
      return;
    }

    found.current = { kind: "document", path: where.activePath, matches };
    if (matches.length === 0) {
      setHighlight(NOTHING);
      at.current = -1;
      report(0, -1, false);
      return;
    }
    setHighlight({ path: where.activePath, matches, active: 0 });
    at.current = 0;
    report(matches.length, 0, false);
  }, [where.content, where.activePath, query, regex]);

  const searchFiles = useCallback(async () => {
    setStatus({ kind: "searching" });
    const result = await where.findInFiles({
      path: scope,
      pattern: query,
      regex,
      // Copied rather than passed through: the request crosses IPC and is parsed by a schema that
      // describes an array, and the app holds its settings as a readonly one.
      fileTypes: [...where.fileTypes],
    });

    if (!result.ok) {
      setStatus(result.reason === "bad-pattern" ? { kind: "bad-pattern" } : { kind: "failed" });
      setHighlight(NOTHING);
      return;
    }

    found.current = { kind: "files", hits: result.hits };
    if (result.hits.length === 0) {
      setHighlight(NOTHING);
      at.current = -1;
      report(0, -1, result.capped);
      return;
    }

    await goTo(0);
    report(result.hits.length, 0, result.capped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [where.findInFiles, where.fileTypes, scope, query, regex, goTo]);

  const search = useCallback(async () => {
    // Nothing to search for. Guarded here as well as by the disabled button, because Enter in the
    // field reaches this directly and an empty query matches every position in every file.
    if (query.trim() === "") return;
    if (tab === "document") searchDocument();
    else await searchFiles();
  }, [query, tab, searchDocument, searchFiles]);

  const step = useCallback(
    async (direction: FindStep) => {
      const list = found.current;
      const count = list.kind === "document" ? list.matches.length : list.hits.length;
      const next = stepIndex(count, at.current, direction);
      if (next < 0) return;

      await goTo(next);
      if (list.kind === "files") {
        // The document branch reports inside `goTo`; this one cannot, because only the search knows
        // whether the answer was capped.
        setStatus((was) => (was.kind === "results" ? { ...was, current: next + 1 } : was));
      }
    },
    [goTo],
  );

  /// Changing tab puts the last search away.
  ///
  /// The two tabs are two searches, not two views of one. Left in place, the document search's
  /// results would still be what Next walked while the Files tab was on screen - a hit list about
  /// one thing, stepped through under a heading about another.
  const changeTab = useCallback((next: FindTab) => {
    setTab(next);
    found.current = { kind: "document", path: null, matches: [] };
    at.current = -1;
    setHighlight(NOTHING);
    setStatus({ kind: "idle" });
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    // The highlights go with it. A dialog that is gone while the document is still marked up leaves
    // colour on the page with nothing to explain it and no way to clear it.
    setHighlight(NOTHING);
    setStatus({ kind: "idle" });
  }, []);

  return {
    open,
    openFind: useCallback(() => setOpen(true), []),
    close,
    tab,
    setTab: changeTab,
    query,
    setQuery,
    regex,
    setRegex,
    status,
    highlight,
    /// The folder Find in Files would search, workspace-relative. "" is the whole folder.
    scope,
    search,
    step,
  };
}
