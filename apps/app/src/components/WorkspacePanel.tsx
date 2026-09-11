import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { enabledFileTypes, workspaceRefLabel } from "@trypthos/domain";
import type { WorkspaceRef } from "@trypthos/domain";
import { matchRows, treeRows, visibleFileCount, type FolderState, type TreeRow } from "../lib/treeRows";
import type { FilterStatus } from "../hooks/useFileFilter";
import type { RemoteNode } from "../lib/workspaceClient";
import ContextMenu, { ContextMenuItem } from "./ContextMenu";
import Glyph from "./Glyph";

interface Props {
  /// Rendered width, resolved against the window. The panel does not choose its own size.
  width: number;
  onCollapse: () => void;
  /// Every open workspace, in the order they were opened. Each is a tree of its own.
  ///
  /// The reference is what says which provider it came from, which is what draws its icon - a folder
  /// and a repository look alike in a tree and are very different things to save into.
  workspaces: readonly { id: string; name: string; ref: WorkspaceRef; truncated: boolean }[];
  folders: Record<string, FolderState>;
  filter: string;
  /// What the search behind the filter box is doing, and what it found.
  ///
  /// A filter searches every open folder rather than sieving the rows already on screen, so while
  /// one is typed the panel draws THAT answer instead of the tree - see `matchRows`.
  filterStatus: FilterStatus;
  /// The document on screen, highlighted as the one you are in.
  activePath: string | null;
  /// Every open document. Marked more lightly than the active one - clicking one of these goes to
  /// its tab rather than loading the file again.
  openPaths: readonly string[];
  /// The open documents with unsaved work.
  dirtyPaths: readonly string[];
  onOpenWorkspace: () => void;
  /// Opens the repository picker. A separate act from `onOpenWorkspace` because it asks a different
  /// question - the folder picker is the operating system's, and this one is ours.
  onOpenRepo: () => void;
  onFilterChange: (filter: string) => void;
  onToggleFolder: (path: string) => void;
  onRetryFolder: (path: string) => void;
  /// Lists a workspace's open folders again, from its right-click menu. Only ever called for a
  /// local folder - a repository is held at one commit, so asking again answers from the same tree.
  onRefreshWorkspace: (workspaceId: string) => void;
  onOpenFile: (node: RemoteNode) => void;
  /// The file types the user has turned on, by id. What the tree lists is filtered by these, and
  /// the footer names them.
  fileTypes: readonly string[];
  /// The folder chat maps when its Folder button is on, workspace-relative. "" is the root, which
  /// is drawn as selected only when a folder row is not.
  selectedFolder: string;
  /// Chooses that folder. Clicking a folder both selects it and expands or collapses it - one
  /// click, because a row that needed two different gestures for two different meanings would need
  /// two different targets, and this row is one word wide.
  onSelectFolder: (path: string) => void;
  /// Closes one folder, and the documents that came from it. The asking happens above.
  onCloseWorkspace: (workspaceId: string) => void;
  /// Opens a repository's own page. Only ever called for a GitHub workspace - a local folder has no
  /// repository behind it and nothing to show.
  onOpenRepoPage: (workspaceId: string) => void;
  /// Opens the File types page of Settings.
  ///
  /// The footer is the only place the setting is discoverable at all: every type but markdown is
  /// off by default, so a user who never opens Settings would never learn it exists. Naming what is
  /// on and being the way to change it is one affordance rather than a label plus a hunt.
  onOpenFileTypes: () => void;
}

/// Left panel: the folder browser.
///
/// Presentational. What is listed, what a click does and what a failure says all live in
/// useWorkspace and treeRows, so this can be restyled without touching behaviour.
export default function WorkspacePanel({
  width,
  onCollapse,
  workspaces,
  folders,
  filter,
  filterStatus,
  activePath,
  openPaths,
  dirtyPaths,
  onOpenWorkspace,
  onOpenRepo,
  onFilterChange,
  onToggleFolder,
  onRetryFolder,
  onRefreshWorkspace,
  onOpenFile,
  fileTypes,
  selectedFolder,
  onSelectFolder,
  onCloseWorkspace,
  onOpenRepoPage,
  onOpenFileTypes,
}: Props) {
  const { t } = useTranslation();
  /// The workspace the right-click menu is about, and where to draw it. Null when it is closed.
  ///
  /// The ID rather than the workspace, so one closed while the menu is open takes the menu with it
  /// instead of leaving it acting on a workspace that is no longer there.
  const [menu, setMenu] = useState<{ workspaceId: string; x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const menuWorkspace =
    menu === null ? undefined : workspaces.find((workspace) => workspace.id === menu.workspaceId);
  /// Which of the two things this panel is right now: the tree, or the answer to a filter.
  ///
  /// Not a variation of one walk. A filter is a search of every open folder, so what it draws comes
  /// from the paths that came back rather than from the folders that happen to have been listed -
  /// which is how a match inside a folder nobody expanded gets on screen at all.
  const filtering = filterStatus.kind !== "idle";
  // Memoised rather than written inline: it feeds the rows below, and a fresh `[]` on every render
  // would rebuild every tree on every keystroke in the editor.
  const matches = useMemo(
    () => (filterStatus.kind === "results" ? filterStatus.paths : []),
    [filterStatus],
  );

  /// One list of rows per open folder. Separate walks rather than one, because they are separate
  /// trees on screen - each with its own root row that can be collapsed and closed.
  const trees = useMemo(
    () =>
      workspaces.map((workspace) => ({
        workspace,
        // A root is a folder like any other, so it is collapsed in the same way: by not having been
        // listed. The map is the only record of what is open, which is what keeps expanding, its
        // failure and its retry one mechanism rather than two.
        state: folders[workspace.id],
        // One level in from the root, because the root is a ROW now. Both builders measure depth
        // from the folder they were given, so direct children come back at zero - which is the depth
        // the root itself is drawn at, and drew a workspace's own folders level with the workspace.
        rows: (filtering
          ? matchRows(matches, workspace.id, fileTypes)
          : treeRows(folders, fileTypes, workspace.id)
        ).map((row) => ({ ...row, depth: row.depth + 1 })),
      })),
    [workspaces, folders, filtering, matches, fileTypes],
  );
  // A folder with nothing matching is left out entirely while filtering. A heading with no rows
  // under it says a folder was searched, which is not what the box was asked - and when none of them
  // has anything, the message below is the one thing on screen.
  const shown = filtering ? trees.filter((tree) => tree.rows.length > 0) : trees;
  const rows = useMemo(() => shown.flatMap((tree) => tree.rows), [shown]);
  const fileCount = visibleFileCount(rows);
  const noMatches = filterStatus.kind === "results" && matches.length === 0;

  // Resolved through the domain rather than counting the stored ids, so a pinned type and an id
  // this build does not recognise are handled here exactly as the tree handles them. The footer
  // must describe what is actually being listed, not what a settings file happens to say.
  const types = enabledFileTypes(fileTypes);
  const typesLabel =
    types.length === 1 ? t(types[0]!.labelKey) : t("workspace.typeCount", { count: types.length });

  return (
    <aside
      aria-label={t("workspace.title")}
      style={{ width }}
      className="flex shrink-0 flex-col overflow-hidden bg-panel"
    >
      <div className="flex items-center gap-1 border-b border-rule px-3 py-2">
        <h2 className="truncate text-xs font-semibold tracking-[0.06em] text-ink-4 uppercase">
          {t("workspace.title")}
        </h2>
        <button
          type="button"
          onClick={onCollapse}
          aria-label={t("panels.collapseWorkspace")}
          title={t("panels.collapseWorkspace")}
          className="ml-auto rounded p-1 text-ink-4 hover:bg-hover hover:text-ink"
        >
          <Glyph>
            <path d="M15 6l-6 6 6 6" />
          </Glyph>
        </button>
        {/* One button per source rather than a menu behind one. There are two, the panel header has
            room for two, and a menu would put the only cloud source Trypthos has behind a click that
            says nothing about what is in it. This is the place a third one changes shape. */}
        <button
          type="button"
          onClick={onOpenRepo}
          aria-label={t("workspace.openRepo")}
          title={t("workspace.openRepo")}
          className="rounded p-1 text-ink-4 hover:bg-hover hover:text-ink"
        >
          <SourceGlyph kind="github" className="size-4" />
        </button>
        <button
          type="button"
          onClick={onOpenWorkspace}
          aria-label={t("workspace.openFolder")}
          title={t("workspace.openFolder")}
          className="rounded p-1 text-ink-4 hover:bg-hover hover:text-ink"
        >
          <Glyph>
            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
            <path d="M12 10v6M9 13h6" />
          </Glyph>
        </button>
      </div>

      {workspaces.length === 0 ? (
        <p className="p-3 text-sm text-ink-3">{t("workspace.noFolder")}</p>
      ) : (
        <>
          <div className="px-2 pt-2">
            <input
              type="search"
              value={filter}
              onChange={(event) => onFilterChange(event.target.value)}
              placeholder={t("workspace.filter")}
              aria-label={t("workspace.filter")}
              // The wildcards are the one thing about this box a user cannot see. On the tooltip
              // rather than in the placeholder, which has to stay short enough to read at this width.
              title={t("workspace.filterHint")}
              className="w-full rounded-md border border-rule bg-app px-2 py-1 text-ui text-ink placeholder:text-faint"
            />
          </div>

          <div className="min-h-0 grow overflow-auto px-1 py-2">
            {/* A walk of every open folder takes as long as those folders are big, so the panel says
                what it is doing rather than sitting silently on rows from the last filter. */}
            {filterStatus.kind === "searching" && (
              <p className="px-2 py-1 text-sm text-ink-4">{t("workspace.searching")}</p>
            )}

            {noMatches && (
              <p className="px-2 py-1 text-sm text-ink-4">{t("workspace.noMatches")}</p>
            )}

            {/* An answer cut short that does not say so is a wrong answer given confidently. */}
            {filterStatus.kind === "results" && filterStatus.truncated && (
              <p className="px-2 py-1 text-xs text-ink-4">{t("workspace.matchesCapped")}</p>
            )}

            {shown.map(({ workspace, state, rows: tree }) => (
              <div
                key={workspace.id}
                // On the whole of the workspace's section rather than its root row, so the menu is
                // found by right-clicking whatever you are looking at - not by scrolling up to the
                // root first. Right-clicking asks; it does not open, select or toggle anything.
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({ workspaceId: workspace.id, x: event.clientX, y: event.clientY });
                }}
              >
                {/* The workspace's own row. It behaves like the folder it is - selecting it is what
                    points chat and Find at the whole workspace - and it is the only row that can be
                    closed, because closing is something you do to a folder you opened. */}
                <WorkspaceRow
                  workspace={workspace}
                  status={filtering ? null : (state?.status ?? null)}
                  expanded={state !== undefined && state.status !== "error"}
                  filtering={filtering}
                  selected={selectedFolder === workspace.id}
                  onToggle={() => {
                    onSelectFolder(workspace.id);
                    // A repository's row is its home, so clicking it opens its page as well as
                    // expanding it. Opening a tab that is already open only switches to it, so a
                    // second click costs nothing.
                    if (workspace.ref.kind === "github") onOpenRepoPage(workspace.id);
                    // There is nothing to collapse while filtering: what is under this row came from
                    // the search, not from the map of folders that have been listed.
                    if (!filtering) void onToggleFolder(workspace.id);
                  }}
                  onRetry={() => onRetryFolder(workspace.id)}
                  onClose={() => onCloseWorkspace(workspace.id)}
                />

                {/* Per folder rather than once for the panel. "This folder is empty" said over two
                    open folders would be a claim about neither of them - and said about one nobody
                    has looked inside yet, a claim the panel cannot make at all. */}
                {!filtering && state?.status === "loaded" && tree.length === 0 && (
                  <p className="px-2 py-1 text-sm text-ink-4">{t("workspace.emptyFolder")}</p>
                )}

                {tree.map((row) =>
                  row.node.kind === "directory" ? (
                    <FolderRow
                      key={row.node.id}
                      row={row}
                      filtering={filtering}
                      selected={selectedFolder === row.node.id}
                      onToggle={() => {
                        onSelectFolder(row.node.id);
                        if (!filtering) void onToggleFolder(row.node.id);
                      }}
                      onRetry={() => onRetryFolder(row.node.id)}
                    />
                  ) : (
                    <FileRow
                      key={row.node.id}
                      row={row}
                      selected={row.node.id === activePath}
                      open={openPaths.includes(row.node.id)}
                      dirty={dirtyPaths.includes(row.node.id)}
                      onOpen={() => onOpenFile(row.node)}
                    />
                  ),
                )}
              </div>
            ))}
          </div>

          {menuWorkspace !== undefined && menu !== null && (
            <ContextMenu label={menuWorkspace.name} x={menu.x} y={menu.y} onDismiss={closeMenu}>
              {/* Greyed for a repository rather than left out: an entry that comes and goes by
                  workspace is harder to learn than one that says it does not apply here. */}
              <ContextMenuItem
                disabled={menuWorkspace.ref.kind === "github"}
                title={menuWorkspace.ref.kind === "github" ? t("workspace.refreshRepoHint") : undefined}
                onClick={() => {
                  setMenu(null);
                  onRefreshWorkspace(menuWorkspace.id);
                }}
              >
                {t("workspace.refresh")}
              </ContextMenuItem>
            </ContextMenu>
          )}

          <div className="flex items-center gap-1 border-t border-rule px-3 py-1 text-xs text-faint">
            <button
              type="button"
              onClick={onOpenFileTypes}
              title={t("workspace.fileTypesHint")}
              className="rounded px-1 underline decoration-dotted underline-offset-2 hover:bg-hover hover:text-ink-2"
            >
              {typesLabel}
            </button>
            <span aria-hidden="true">{"·"}</span>
            <span>{t("workspace.footer", { count: fileCount })}</span>
          </div>
        </>
      )}
    </aside>
  );
}

/// Rows indent by depth. The value is inline because it is computed; everything else is a class.
const indent = (depth: number) => ({ paddingLeft: `${depth * 16 + 4}px` });

/// One open folder's own row: its name, and the only close button in the panel.
///
/// The close sits at the END of the row rather than beside the name, so the names line up down the
/// panel and the crosses line up down the other edge - and it is a button inside a button's row
/// rather than nested in one, because a control inside a control is a control nobody can reach with
/// a keyboard in a predictable order.
function WorkspaceRow({
  workspace,
  status,
  expanded,
  filtering,
  selected,
  onClose,
  onToggle,
  onRetry,
}: {
  workspace: { id: string; name: string; ref: WorkspaceRef; truncated: boolean };
  /// What is known about the root's own listing, or null when it has never been asked for.
  status: FolderState["status"] | null;
  expanded: boolean;
  /// True while the panel is showing the answer to a filter rather than the tree.
  ///
  /// The rows under this one then came from a search, so there is nothing here to collapse - and the
  /// chevron goes with the behaviour rather than staying as a control that does nothing.
  filtering: boolean;
  selected: boolean;
  onClose: () => void;
  onToggle: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <div
        className={
          selected
            ? "flex items-center gap-1 rounded-md bg-selected pr-1"
            : "flex items-center gap-1 rounded-md pr-1 hover:bg-hover"
        }
      >
        <button
          type="button"
          onClick={onToggle}
          // Undefined while filtering: nothing under this row can be collapsed, and a row that
          // announces itself as expandable and then does nothing is worse than one that does not.
          aria-expanded={filtering ? undefined : expanded}
          // Selection and expansion are separate facts about a folder, so they are separate
          // attributes - exactly as they are on a folder inside one. A root can be the folder chat
          // is mapping while collapsed, and expanded while some other folder is chosen.
          aria-current={selected ? "true" : undefined}
          // What the name does not say. Two folders can share a name and so can two repositories,
          // and the tree shows only the name - so the tooltip carries the whole path, or the owner
          // and repository together.
          title={workspaceRefLabel(workspace.ref)}
          // The same helper every other row uses, at depth 0, rather than a padding class that
          // happens to match it - one way of expressing an indent is one thing to keep in step.
          style={indent(0)}
          className={
            selected
              ? "flex min-w-0 grow items-center gap-1.5 py-1 text-left text-base font-semibold text-selected-ink"
              : "flex min-w-0 grow items-center gap-1.5 py-1 text-left text-base font-semibold text-ink"
          }
        >
          {filtering ? <ChevronSpace /> : <Chevron open={expanded} />}
          {/* Which provider this workspace came from. A folder and a repository sit in the same
              tree and behave very differently - one can be saved into and the other cannot - so
              they do not look alike: a different mark, and a different colour behind it. At this
              size the shape alone is a small difference down a panel of otherwise identical rows.

              A failing workspace overrides both, because what is wrong with it matters more than
              where it came from. */}
          <SourceGlyph
            kind={workspace.ref.kind}
            className={
              status === "error" ? "size-3.5 text-danger" : `size-3.5 ${sourceColour(workspace.ref.kind)}`
            }
          />
          <span className="min-w-0 truncate">{workspace.name}</span>
          {status === "loading" && (
            <span className="ml-auto shrink-0 text-2xs text-faint">{t("workspace.loading")}</span>
          )}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("workspace.closeFolder", { name: workspace.name })}
          title={t("workspace.closeFolder", { name: workspace.name })}
          className="shrink-0 rounded p-1 text-ink-4 hover:bg-hover hover:text-ink"
        >
          <Glyph className="size-3.5">
            <path d="M6 6l12 12M18 6L6 18" />
          </Glyph>
        </button>
      </div>

      {/* A listing that could not be complete says so, on the workspace it belongs to. GitHub cuts
          a very large tree short, and a browser quietly missing folders is a wrong answer given
          confidently rather than an incomplete one. */}
      {workspace.truncated && !filtering && (
        <p style={indent(1)} className="py-0.5 pr-2 text-xs text-ink-4">
          {t("workspace.truncatedRepo")}
        </p>
      )}

      {/* Inline on the row that failed, exactly as it is for a folder inside one. A root can fail to
          list too - a folder that has been unmounted or renamed since it was opened - and now that
          it can be collapsed and expanded again, it can fail at a moment the user is watching. */}
      {status === "error" && (
        <p
          style={indent(1)}
          className="flex items-center gap-2 py-0.5 pr-2 text-xs text-danger"
        >
          <span>{t("workspace.listFailed")}</span>
          <button type="button" onClick={onRetry} className="font-semibold underline">
            {t("workspace.retry")}
          </button>
        </p>
      )}
    </>
  );
}

function FolderRow({
  row,
  filtering,
  selected,
  onToggle,
  onRetry,
}: {
  row: TreeRow;
  /// True while these rows are a filter's answer rather than the tree. See `WorkspaceRow`.
  filtering: boolean;
  selected: boolean;
  onToggle: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={filtering ? undefined : row.expanded}
        // Selection and expansion are separate facts about a folder, so they are separate
        // attributes: a folder can be the one chat is mapping while collapsed, and expanded while
        // some other folder is chosen.
        aria-current={selected ? "true" : undefined}
        style={indent(row.depth)}
        className={
          selected
            ? "flex w-full items-center gap-1.5 rounded-md bg-selected py-1 pr-2 text-left text-base font-semibold text-selected-ink"
            : "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-base text-ink hover:bg-hover"
        }
      >
        {filtering ? <ChevronSpace /> : <Chevron open={row.expanded} />}
        <Glyph className={row.status === "error" ? "size-3.5 text-danger" : "size-3.5 text-leaf"}>
          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
        </Glyph>
        <span className="min-w-0 truncate">{row.node.name}</span>
        {row.status === "loading" && (
          <span className="ml-auto shrink-0 text-2xs text-faint">{t("workspace.loading")}</span>
        )}
      </button>

      {/* Inline on the row that failed, never a toast. The rest of the tree still works, and the
          retry belongs beside the thing it would retry. */}
      {row.status === "error" && (
        <p
          style={indent(row.depth + 1)}
          className="flex items-center gap-2 py-0.5 pr-2 text-xs text-danger"
        >
          <span>{t("workspace.listFailed")}</span>
          <button type="button" onClick={onRetry} className="font-semibold underline">
            {t("workspace.retry")}
          </button>
        </p>
      )}
    </>
  );
}

function FileRow({
  row,
  selected,
  open,
  dirty,
  onOpen,
}: {
  row: TreeRow;
  selected: boolean;
  open: boolean;
  dirty: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();

  // A plain div, not a disabled button. A disabled button is still in the accessibility tree, still
  // announced as something to activate, and still something a keyboard lands on - three promises
  // about a row that does nothing. `aria-disabled` says the same thing without any of that.
  if (!row.openable) {
    return (
      <div
        aria-disabled="true"
        title={t("workspace.cannotOpen")}
        style={indent(row.depth + 1)}
        className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-base text-faint"
      >
        <Glyph className="size-3.5 shrink-0 text-faint">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </Glyph>
        <span className="min-w-0 truncate">{row.node.name}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={selected ? "true" : undefined}
      // Three states, not two: the file you are in, the files you have open behind it, and the rest.
      // Without the middle one a click on an open file looks like it did nothing, when what it did
      // was go to a tab.
      data-open={open ? "true" : undefined}
      style={indent(row.depth + 1)}
      className={
        selected
          ? "flex w-full items-center gap-1.5 rounded-md bg-selected py-1 pr-2 text-left text-base font-semibold text-selected-ink"
          : open
            ? "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-base text-ink hover:bg-hover"
            : "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-base text-ink-3 hover:bg-hover"
      }
    >
      <Glyph className="size-3.5 shrink-0 text-faint">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </Glyph>
      <span className="min-w-0 truncate">{row.node.name}</span>
      {dirty && (
        <span
          title={t("workspace.unsavedDot")}
          aria-label={t("workspace.unsavedDot")}
          className="ml-auto size-1.5 shrink-0 rounded-full bg-accent"
        />
      )}
    </button>
  );
}

/// The chevron's room, kept while filtering so the names still line up down the panel.
///
/// A gap rather than a greyed-out chevron: there is nothing to expand, and a disabled-looking
/// control invites a click that will never do anything.
function ChevronSpace() {
  return <span aria-hidden="true" className="size-3.5 shrink-0" />;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <Glyph className={open ? "size-3.5 shrink-0 rotate-90 text-ink-4" : "size-3.5 shrink-0 text-ink-4"}>
      <path d="M9 6l6 6-6 6" />
    </Glyph>
  );
}

/// The colour a provider's mark takes on a workspace row.
///
/// Green is the folder colour this app has always used for a folder; a repository is not one, and
/// it takes the accent instead. A `switch` for the same reason `SourceGlyph` is one - a provider
/// added to the schema without a colour is a type error here rather than two sources that look the
/// same in the tree.
///
/// A class rather than a hex, so both themes are answered by the token the rest of the app reads.
function sourceColour(kind: WorkspaceRef["kind"]): string {
  switch (kind) {
    case "github":
      return "text-accent";
    case "local":
      return "text-leaf";
  }
}

/// The mark for one provider.
///
/// A `switch` over the kind rather than a lookup with a fallback, so adding a provider to the schema
/// and forgetting its icon is a type error here rather than a folder icon on a repository.
function SourceGlyph({ kind, className }: { kind: WorkspaceRef["kind"]; className?: string }) {
  switch (kind) {
    case "github":
      return (
        <Glyph className={className}>
          <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
        </Glyph>
      );
    case "local":
      return (
        <Glyph className={className}>
          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
        </Glyph>
      );
  }
}

