import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EMPTY_CONTEXT,
  contextCharacterBudget,
  qualifyPath,
  resolveChatContext,
  splitQualified,
  type ChatContext,
  type FolderOutline,
} from "@trypthos/domain";

/// What chat is allowed to see, beyond the document.
///
/// Two things the user chooses, and they answer different questions:
///
///   - **Attachments** are "also look at this one", and are read in full. Explicit because guessing
///     which other files are relevant is how a chat quietly spends somebody's context window, and on
///     a hosted endpoint their money.
///   - **The folder** is a map: paths only, so the model can say "that will be in notes/plan.md" and
///     the user can attach it. Its contents are never sent - a notes folder can be thousands of
///     files, and sending them would bury the document the question was about.
///
/// Both are held here rather than in `useChat`, which owns the conversation. The two meet only when
/// a turn is sent.

export interface ScopeBridge {
  /// The files in one folder of the workspace. The walk happens in the shell, where the workspace
  /// is, and the path is validated there like every other one the renderer names.
  workspaceOutline(
    path: string,
  ): Promise<{ ok: true; outline: FolderOutline } | { ok: false; reason: string }>;
  readFile(path: string): Promise<{ ok: true; content: string } | { ok: false; reason: string }>;
}

export interface ScopeSource {
  selection: string;
  /// The open file, with the id of its type from the catalogue - or null when nothing recognises
  /// it. The model is told which kind of file it is looking at, so an answer about a Python file
  /// is not phrased as though it were prose.
  file: { path: string; content: string; fileType: string | null } | null;
}

/// `folderPath` is the folder selected in the tree, "" being the workspace root. Changing it
/// re-reads the outline and clears the picker's list, because both describe a folder and the one
/// they describe has just changed - a stale list would offer files that are somewhere else.
export function useChatScope(
  bridge: ScopeBridge | null,
  source: () => ScopeSource,
  folderPath: string,
  /// The active model's context window, which sizes how much document and attachment text is sent -
  /// see `contextCharacterBudget`. Null for a model nobody has sized, which keeps the fixed budget.
  contextWindow: number | null = null,
) {
  /// Files the user attached, with their contents at the moment they were attached.
  const [attachments, setAttachments] = useState<{ path: string; content: string }[]>([]);
  const [includeFolder, setIncludeFolder] = useState(false);
  const [outline, setOutline] = useState<FolderOutline | null>(null);
  /// The picker's files, WITH the folder they came from.
  ///
  /// Kept together so staleness is derived rather than reset: a list describing one folder must not
  /// survive into another, and clearing it from an effect on `folderPath` would be a cascading
  /// render to express something the data can say itself.
  ///
  /// Fetched on demand and independently of `includeFolder`: picking a file to attach is not the
  /// same as sending the whole map.
  const [loaded, setLoaded] = useState<{ folder: string; paths: string[] }>({
    folder: "",
    paths: [],
  });
  const files = loaded.folder === folderPath ? loaded.paths : [];

  useEffect(() => {
    if (!includeFolder || bridge === null) return;

    let cancelled = false;
    void bridge.workspaceOutline(folderPath)
      .then((result) => {
        if (cancelled || !result.ok) return;
        setOutline(result.outline);
      })
      // A rejected invoke is how this failed silently for two releases: the shell's handler threw,
      // nothing here was listening, and the folder was simply never sent. Caught so it is a handled
      // failure rather than an unhandled rejection - the folder still goes unsent, which is why the
      // guards that stop the handler throwing at all are the real fix.
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [bridge, includeFolder, folderPath]);

  /// Fetches the folder's files for the picker, if they are not already known.
  ///
  /// Once per panel rather than on every open: the walk is not free, and a folder does not usually
  /// change between one attachment and the next. Reopening Trypthos re-reads it.
  const loadFiles = useCallback(async () => {
    if (bridge === null || files.length > 0) return;

    const result = await bridge.workspaceOutline(folderPath);
    if (!result.ok) return;

    // Qualified here, because the outline names files from the WORKSPACE ROOT - that list is what
    // the model is shown - while a read has to say which of the open folders it means. Left as it
    // came, every file chosen from the picker was a read of nothing, refused and dropped.
    const workspaceId = splitQualified(folderPath)?.workspaceId;
    setLoaded({
      folder: folderPath,
      paths:
        workspaceId === undefined
          ? result.outline.paths
          : result.outline.paths.map((path) => qualifyPath(workspaceId, path)),
    });
  }, [bridge, files.length, folderPath]);

  /// Why the last attach failed, as a failure reason, or null.
  ///
  /// Kept rather than dropped: a file that could not be read used to vanish without a word, which is
  /// exactly what made a broken picker look like a list whose entries did nothing.
  const [attachFailure, setAttachFailure] = useState<string | null>(null);

  const attach = useCallback(
    async (path: string) => {
      if (bridge === null) return;

      const result = await bridge.readFile(path);
      if (!result.ok) {
        setAttachFailure(result.reason);
        return;
      }
      setAttachFailure(null);

      // Deduplicated inside the update rather than before the read. Two attaches in quick
      // succession both see the same captured list, so a check outside here lets the second one
      // through - and the file is then sent twice, spending the budget on a duplicate.
      setAttachments((current) =>
        current.some((attachment) => attachment.path === path)
          ? current
          : [...current, { path, content: result.content }],
      );
    },
    [bridge],
  );

  const detach = useCallback((path: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.path !== path));
  }, []);

  /// Each attachment with the text it was attached with, for a conversation being saved.
  const saved = useCallback(() => attachments, [attachments]);

  /// Puts back what a saved conversation was held with: its attachments, with the text they had
  /// then, and whether the folder was attached. Nothing is read - the conversation was about those
  /// words, and the file may have changed or gone since.
  const restore = useCallback(
    (restored: readonly { path: string; content: string }[], folder: boolean) => {
      setAttachments(restored.map(({ path, content }) => ({ path, content })));
      setIncludeFolder(folder);
      setAttachFailure(null);
    },
    [],
  );

  const clear = useCallback(() => {
    setAttachments([]);
    setIncludeFolder(false);
    setAttachFailure(null);
  }, []);

  /// Built when a turn is sent, so it sees the selection and the buffer as they are then.
  const context = useCallback((): ChatContext => {
    const { selection, file } = source();
    if (bridge === null) return EMPTY_CONTEXT;

    return resolveChatContext({
      selection,
      file,
      attachments,
      folder: includeFolder ? outline : null,
      // The model's own budget. A fixed sixty thousand characters for every model cut attachments
      // short, or sent them empty, to a model with room for a quarter of a million tokens (#145).
      budget: contextCharacterBudget(contextWindow),
    });
  }, [attachments, bridge, contextWindow, includeFolder, outline, source]);

  const paths = useMemo(() => attachments.map((attachment) => attachment.path), [attachments]);

  return {
    attachments: paths,
    files,
    loadFiles,
    includeFolder,
    setIncludeFolder,
    attach,
    attachFailure,
    detach,
    clear,
    saved,
    restore,
    context,
  };
}
