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
      /// True when a Google Drive folder was searched only where it has been opened. Absent otherwise.
      partial?: boolean;
    };

/// Which view a document's find offsets were measured against.
///
/// An editable view shows the source and its offsets are into that source; Preview shows the rendered
/// prose and its offsets are into what a reader sees there. The two coordinate systems do not agree -
/// an offset into one is meaningless in the other - so the highlight carries which it came from, and
/// only the surface it names wears it.
export type FindSurfaceKind = "editable" | "preview";

/// Which coordinates a highlight's offsets are in. A search of the open document is measured against
/// the view on screen - `editable` or `preview` - and belongs to that view only: switch away and it is
/// cleared. A Find in Files hit is `source`: offsets into the file as read off disk, whatever view it
/// is in, which is why the panel brings such a file out of Preview to show it and does not for a
/// document search.
export type FindHighlightSurface = FindSurfaceKind | "source";

/// What a document's find searches: the text of the view on screen. The source for an editable view,
/// the rendered prose's visible text for Preview.
export interface FindSurface {
  kind: FindSurfaceKind;
  text: string;
}

/// What the editor should be highlighting, and in which document.
///
/// The path travels with the matches so a highlight cannot end up painted over another file's text:
/// the offsets came from one document, and only that document should wear them. `surface` says which
/// view those offsets were measured against - see `FindSurfaceKind`.
export interface FindHighlight {
  path: string | null;
  matches: readonly FindMatch[];
  active: number;
  surface: FindHighlightSurface;
}

const NOTHING: FindHighlight = { path: null, matches: [], active: -1, surface: "editable" };

/// What the find needs from the window around it.
///
/// Passed in rather than reached for, so the hook can be tested without a workspace, a shell or an
/// editor - and so the two searches sit side by side here rather than half in a component.
export interface FindSurroundings {
  /// The text of the document on screen.
  content: string;
  activePath: string | null;
  /// What the document tab searches - the view on screen, not always the source. An editable view is
  /// read as its source; Preview as its rendered prose's visible text. Absent in a test that only
  /// exercises a source search, which then falls back to `content`.
  surface?: () => FindSurface;
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
  /// Off to begin with, because that is what every other search in the app does. The option exists
  /// because a case-insensitive search of a source file is nearly useless: `state`, `State` and
  /// `STATE` are three things in code and one in prose.
  const [caseSensitive, setCaseSensitive] = useState(false);
  /// Where the panel has been dragged to, relative to the editor it floats over. Null until it is
  /// moved, which leaves it wherever the stylesheet puts it.
  ///
  /// Held HERE rather than in the dialog, which unmounts when the find closes: a panel moved out of
  /// the way of the text you were reading would go back to covering it on the next Ctrl+F.
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [status, setStatus] = useState<FindStatus>({ kind: "idle" });
  const [highlight, setHighlight] = useState<FindHighlight>(NOTHING);

  /// The matches of the last search, and what walking them means.
  ///
  /// A ref rather than state: `step` reads it and writes the highlight, and nothing renders from it
  /// directly - the status line renders from `status`. Held as one object so a search that replaces
  /// both halves cannot leave a stale index pointing into a new list.
  const found = useRef<
    | { kind: "document"; path: string | null; matches: readonly FindMatch[]; surface: FindSurfaceKind }
    | { kind: "files"; hits: readonly FileHit[] }
  >({ kind: "document", path: null, matches: [], surface: "editable" });
  const at = useRef(-1);

  /// The folder Find in Files would look in, so the dialog can say which before it runs.
  const scope = searchScopeFolder({
    selectedFolder: where.selectedFolder,
    activePath: where.activePath,
  });

  const report = (total: number, current: number, capped: boolean, partial = false) =>
    setStatus({ kind: "results", total, current: current + 1, capped, ...(partial ? { partial } : {}) });

  /// Puts the reader on one of the results.
  ///
  /// The two tabs differ in what that costs: within a document it is a highlight, and across files
  /// it is opening the file first. Both end the same way, with one value saying what to highlight.
  const goTo = useCallback(
    async (index: number) => {
      const list = found.current;
      at.current = index;

      if (list.kind === "document") {
        setHighlight({ path: list.path, matches: list.matches, active: index, surface: list.surface });
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
      // but a highlight for a file that failed to open would be one nothing ever clears. A Files hit
      // is always read in an editable view: its offsets are into the source as read off disk, and the
      // panel brings such a document out of Preview so they can be shown at all.
      await where.openPath(hit.path);
      setHighlight({ path: hit.path, matches: [{ from: hit.from, to: hit.to }], active: 0, surface: "source" });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [where.openPath],
  );

  const searchDocument = useCallback(() => {
    // The view on screen, not always the source: an editable view is read as its source, Preview as
    // its rendered prose. One search against what is actually shown keeps the count and the highlight
    // in agreement - a search of the source while reading the prose would report matches that cannot
    // be painted where the reader is.
    const surface = where.surface?.() ?? { kind: "editable", text: where.content };
    const matches = findMatches(surface.text, query, { regex, caseSensitive });
    if (matches === null) {
      setStatus({ kind: "bad-pattern" });
      setHighlight(NOTHING);
      return;
    }

    found.current = { kind: "document", path: where.activePath, matches, surface: surface.kind };
    if (matches.length === 0) {
      setHighlight(NOTHING);
      at.current = -1;
      report(0, -1, false);
      return;
    }
    setHighlight({ path: where.activePath, matches, active: 0, surface: surface.kind });
    at.current = 0;
    report(matches.length, 0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [where.surface, where.content, where.activePath, query, regex, caseSensitive]);

  const searchFiles = useCallback(async () => {
    setStatus({ kind: "searching" });
    const result = await where.findInFiles({
      path: scope,
      pattern: query,
      regex,
      caseSensitive,
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
      report(0, -1, result.capped, result.partial === true);
      return;
    }

    await goTo(0);
    report(result.hits.length, 0, result.capped, result.partial === true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [where.findInFiles, where.fileTypes, scope, query, regex, caseSensitive, goTo]);

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
    found.current = { kind: "document", path: null, matches: [], surface: "editable" };
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

  /// Puts the last search away without closing the dialog - what a change of view asks for.
  ///
  /// The offsets were measured against one surface; once that is no longer on screen they would sit
  /// over nothing, and a count with nothing to show it reads as an answer. Clearing both halves keeps
  /// the dialog honest about a document it can no longer point at.
  const reset = useCallback(() => {
    found.current = { kind: "document", path: null, matches: [], surface: "editable" };
    at.current = -1;
    setHighlight(NOTHING);
    setStatus({ kind: "idle" });
  }, []);

  return {
    open,
    openFind: useCallback(() => setOpen(true), []),
    close,
    reset,
    tab,
    setTab: changeTab,
    query,
    setQuery,
    regex,
    setRegex,
    caseSensitive,
    setCaseSensitive,
    position,
    setPosition,
    status,
    highlight,
    /// The folder Find in Files would search, workspace-relative. "" is the whole folder.
    scope,
    search,
    step,
  };
}
