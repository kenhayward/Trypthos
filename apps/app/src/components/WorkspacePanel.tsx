import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { enabledFileTypes } from "@trypthos/domain";
import { treeRows, visibleFileCount, type FolderState, type TreeRow } from "../lib/treeRows";
import type { RemoteNode } from "../lib/workspaceClient";

interface Props {
  /// Rendered width, resolved against the window. The panel does not choose its own size.
  width: number;
  onCollapse: () => void;
  workspaceName: string | null;
  folders: Record<string, FolderState>;
  filter: string;
  /// The document on screen, highlighted as the one you are in.
  activePath: string | null;
  /// Every open document. Marked more lightly than the active one - clicking one of these goes to
  /// its tab rather than loading the file again.
  openPaths: readonly string[];
  /// The open documents with unsaved work.
  dirtyPaths: readonly string[];
  onOpenWorkspace: () => void;
  onFilterChange: (filter: string) => void;
  onToggleFolder: (path: string) => void;
  onRetryFolder: (path: string) => void;
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
  workspaceName,
  folders,
  filter,
  activePath,
  openPaths,
  dirtyPaths,
  onOpenWorkspace,
  onFilterChange,
  onToggleFolder,
  onRetryFolder,
  onOpenFile,
  fileTypes,
  selectedFolder,
  onSelectFolder,
  onOpenFileTypes,
}: Props) {
  const { t } = useTranslation();
  const rows = useMemo(() => treeRows(folders, filter, fileTypes), [folders, filter, fileTypes]);
  const fileCount = visibleFileCount(rows);
  // Folders survive a filter, so the row list is never empty while any exist - which meant a filter
  // matching nothing left folder rows on screen with no explanation at all. The message keys off the
  // FILE count instead, and reads correctly beside folders nobody has opened yet.
  const noMatches = filter.trim() !== "" && fileCount === 0;

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
          {workspaceName ?? t("workspace.title")}
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

      {workspaceName === null ? (
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
              className="w-full rounded-md border border-rule bg-app px-2 py-1 text-ui text-ink placeholder:text-faint"
            />
          </div>

          <div className="min-h-0 grow overflow-auto px-1 py-2">
            {rows.length === 0 && (
              <p className="px-2 py-1 text-sm text-ink-4">{t("workspace.emptyFolder")}</p>
            )}
            {noMatches && (
              <p className="px-2 py-1 text-sm text-ink-4">{t("workspace.noMatches")}</p>
            )}

            {rows.map((row) =>
              row.node.kind === "directory" ? (
                <FolderRow
                  key={row.node.id}
                  row={row}
                  selected={selectedFolder === row.node.id}
                  onToggle={() => {
                    onSelectFolder(row.node.id);
                    void onToggleFolder(row.node.id);
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

function FolderRow({
  row,
  selected,
  onToggle,
  onRetry,
}: {
  row: TreeRow;
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
        aria-expanded={row.expanded}
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
        <Chevron open={row.expanded} />
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

function Chevron({ open }: { open: boolean }) {
  return (
    <Glyph className={open ? "size-3.5 shrink-0 rotate-90 text-ink-4" : "size-3.5 shrink-0 text-ink-4"}>
      <path d="M9 6l6 6-6 6" />
    </Glyph>
  );
}

function Glyph({ className = "size-3.5", children }: { className?: string; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}
