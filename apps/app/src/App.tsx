import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  PANEL_BOUNDS,
  defaultChatProfile,
  resolveChatContext,
  resolveEdit,
  resolvePanelWidths,
  type ProposedEdit,
} from "@trypthos/domain";
import AboutModal from "./components/AboutModal";
import ChatPanel from "./components/ChatPanel";
import EditorPanel from "./components/EditorPanel";
import type { EditorHandle, EditorSelection } from "./components/MarkdownEditor";
import PanelDivider from "./components/PanelDivider";
import PreferencesDialog from "./components/PreferencesDialog";
import PanelRail from "./components/PanelRail";
import TitleBar from "./components/TitleBar";
import WorkspacePanel from "./components/WorkspacePanel";
import { useApiKeys } from "./hooks/useApiKeys";
import { useChat } from "./hooks/useChat";
import { useChatHistory } from "./hooks/useChatHistory";
import { useSettings } from "./hooks/useSettings";
import { useTheme } from "./hooks/useTheme";
import { useWorkspace } from "./hooks/useWorkspace";
import {
  chatBridge,
  chatHistoryBridge,
  isDesktop,
  keyBridge,
  settingsBridge,
  workspaceClient,
} from "./lib/workspaceClient";
import { currentPlatform, windowControls } from "./lib/windowControls";

/// Stand-in document, shown until a real file is opened.
///
/// A scratch buffer rather than a fake file: nothing here pretends to be on disk, so there is no save
/// path to be wrong about.
const SCRATCH = `# Scratch buffer

Open a folder on the left to edit real files. Until then this text lives only in memory.

**Live** hides markdown syntax except on the line your cursor is on. Click into
this line to see its own markers appear.

- **Source** shows every character, colour-coded by role
- **Preview** renders it as read-only prose

> The text is identical in all three. A mode is a view, never a transform.

Inline \`code\` and a [link](https://example.com) render too.
`;

/// The three-panel shell: workspace browser, editor, chat.
export default function App() {
  const { t } = useTranslation();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const client = useMemo(() => workspaceClient(), []);
  const platform = useMemo(() => currentPlatform(), []);
  const bridge = useMemo(() => settingsBridge(), []);
  const { settings, loaded, updatePanels, update } = useSettings(bridge);

  const keys = useMemo(() => keyBridge(), []);
  /// Passed in so the hook re-checks when a profile is repointed or removed: saving settings sweeps
  /// keys for endpoints nothing references any more, which changes what is stored.
  const configuredEndpoints = useMemo(
    () => settings.chat.profiles.map((profile) => profile.endpoint),
    [settings.chat.profiles],
  );
  const { keyedEndpoints, saveKey, deleteKey } = useApiKeys(keys, configuredEndpoints);


  // The width the three panels share. Measured rather than assumed, because a stored width can come
  // from a wider window than the one it is being restored into.
  const body = useRef<HTMLDivElement | null>(null);
  const [available, setAvailable] = useState(0);
  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;

    // Measured once BEFORE the first paint, then observed. ResizeObserver fires after paint, so
    // relying on it alone meant the first frame had nothing to divide up: every panel resolved to
    // zero width and the layout visibly snapped into place a moment later.
    setAvailable(element.getBoundingClientRect().width);

    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailable(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useTheme(settings.appearance.theme);

  const panels = settings.panels;
  const widths = resolvePanelWidths({
    available,
    workspace: panels.workspaceWidth,
    chat: panels.chatWidth,
    workspaceCollapsed: panels.workspaceCollapsed,
    chatCollapsed: panels.chatCollapsed,
  });
  const { state, actions } = useWorkspace(client, SCRATCH);

  const chatModels = settings.chat.profiles;
  /// Which model answers the next turn.
  ///
  /// Kept for the session rather than persisted: `isDefault` already records which model a new chat
  /// starts on, and a second stored answer to the same question would be one more thing that could
  /// disagree with it. Null falls back to the default, which is also what the shell does.
  const [chosenModel, setChosenModel] = useState<string | null>(null);
  const activeModel =
    chatModels.find((profile) => profile.id === chosenModel) ?? defaultChatProfile(chatModels);

  /// The editor selection, as reported by CodeMirror. Empty text when nothing is selected.
  ///
  /// Held in a ref rather than as state: it changes on every caret move, and re-rendering the whole
  /// three-panel window on each arrow key to store something nothing displays would be a waste.
  /// Chat reads it when a question is sent, and again when an edit is applied.
  const selection = useRef<EditorSelection>({ text: "", from: 0, to: 0 });

  /// The live editor, for applying an edit the user accepted.
  const editor = useRef<EditorHandle>(null);

  /// What the model is told about the document.
  ///
  /// A function, called when a turn is sent, so it sees the selection and the buffer as they are
  /// then. `state.content` rather than the file on disk: once the user has typed, the file is not
  /// what they are looking at.
  const chatContext = useCallback(
    () =>
      resolveChatContext({
        selection: selection.current.text,
        file: state.file === null ? null : { path: state.file.path, content: state.content },
      }),
    [state.file, state.content],
  );

  /// Where a proposed edit would land in the document AS IT IS NOW.
  ///
  /// Resolved on every render rather than when the reply arrived, because the document moves under
  /// it: a heading renamed while the user reads the proposal has to turn Apply off rather than let
  /// the edit write somewhere nobody chose.
  const resolveAgainstDocument = useCallback(
    (edit: ProposedEdit) =>
      resolveEdit(edit, {
        doc: state.content,
        selection:
          selection.current.text === ""
            ? null
            : { from: selection.current.from, to: selection.current.to },
      }),
    [state.content],
  );

  const applyEdit = useCallback(
    (edit: ProposedEdit) => {
      const target = resolveAgainstDocument(edit);
      // Resolved once more at the moment of the click. The render that drew the button may be a
      // keystroke old, and this is a write to somebody's document.
      if (!target.ok) return false;

      editor.current?.applyChange(target.from, target.to, target.insert);
      return true;
    },
    [resolveAgainstDocument],
  );

  const chat = useChat(useMemo(() => chatBridge(), []), activeModel?.id ?? null, chatContext);
  const history = useChatHistory(useMemo(() => chatHistoryBridge(), []));

  /// The file a reopened conversation was about, when it is no longer in the open folder.
  ///
  /// Kept rather than checked on every render: it is a fact about the chat that was opened, and the
  /// answer would not change until a different one is.
  const [missingChatFile, setMissingChatFile] = useState<string | null>(null);

  /// Opens a saved conversation.
  ///
  /// The chat opens whatever became of the file it references - it is the user's own words, and
  /// still worth reading. What it says about a document that has gone is what the panel reports.
  const openChat = useCallback(
    async (id: string) => {
      const session = await history.open(id);
      if (session === null) return;

      chat.replace(session.turns);
      if (session.profileId !== null) setChosenModel(session.profileId);
      setMissingChatFile(
        session.filePath !== null && session.filePath !== state.file?.path ? session.filePath : null,
      );
    },
    [chat, history, state.file?.path],
  );

  // Reopening the folder the app was last closed with. Only once, and only after settings have been
  // read - before that `lastWorkspace` is the default, which is null.
  const reopened = useRef(false);
  useEffect(() => {
    if (!loaded || reopened.current) return;
    reopened.current = true;
    if (settings.lastWorkspace !== null) void actions.reopen(settings.lastWorkspace);
  }, [loaded, settings.lastWorkspace, actions]);

  useEffect(() => {
    const root = state.workspace?.root ?? null;
    if (loaded && root !== null && root !== settings.lastWorkspace) update({ lastWorkspace: root });
  }, [loaded, state.workspace, settings.lastWorkspace, update]);

  // Ctrl+S / Cmd+S. Bound on the window rather than inside the editor so it works wherever focus is,
  // and preventDefault matters: the browser's own save dialog would otherwise open over the app.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void actions.save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions]);

  // Menu items the renderer carries out.
  //
  // Each one drives the path the user already has - the same open, save, preferences and about the
  // buttons and shortcuts use - rather than a second copy of it. That is the whole reason the menu
  // sends an ACTION rather than doing the work in the main process: there is one implementation of
  // each, and the menu is another way to reach it.
  useEffect(
    () =>
      windowControls().onMenuAction((action) => {
        if (action === "open-folder") void actions.open();
        else if (action === "save") void actions.save();
        else if (action === "preferences") setPrefsOpen(true);
        else if (action === "about") setAboutOpen(true);
      }),
    [actions],
  );

  return (
    <div className="flex h-full flex-col bg-app text-ink">
      <TitleBar
        platform={platform}
        fileName={state.file?.name ?? null}
        onAbout={() => setAboutOpen(true)}
        onPreferences={() => setPrefsOpen(true)}
      />

      {state.errorKey !== null && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 border-b border-rule bg-sunken px-3 py-2 text-sm text-ink-2"
        >
          <span>{t(state.errorKey)}</span>
          <button
            type="button"
            onClick={actions.dismissError}
            className="shrink-0 rounded px-1.5 text-ink-4 hover:bg-hover"
          >
            {t("app.dismiss")}
          </button>
        </div>
      )}

      <div ref={body} className="flex min-h-0 grow">
        {panels.workspaceCollapsed ? (
          <PanelRail
            side="left"
            label={t("panels.expandWorkspace")}
            onExpand={() => updatePanels({ workspaceCollapsed: false })}
          />
        ) : (
          <>
        <WorkspacePanel
          width={widths.workspace}
          onCollapse={() => updatePanels({ workspaceCollapsed: true })}
          workspaceName={state.workspace?.name ?? null}
          folders={state.folders}
          filter={state.filter}
          openFilePath={state.file?.path ?? null}
          dirty={state.dirty}
          onOpenWorkspace={() => void actions.open()}
          onFilterChange={actions.setFilter}
          onToggleFolder={(path) => void actions.toggleFolder(path)}
          onRetryFolder={(path) => void actions.retryFolder(path)}
          onOpenFile={(node) => void actions.openFile(node)}
        />
            <PanelDivider
              grows="right"
              width={widths.workspace}
              min={PANEL_BOUNDS.workspace.min}
              max={PANEL_BOUNDS.workspace.max}
              label={t("panels.workspaceDivider")}
              onResize={(workspaceWidth) => updatePanels({ workspaceWidth })}
            />
          </>
        )}

        <EditorPanel
          workspaceName={state.workspace?.name ?? null}
          filePath={state.file?.path ?? null}
          dirty={state.dirty}
          value={state.content}
          onSelectionChange={(next) => (selection.current = next)}
          ref={editor}
          onChange={actions.edit}
        />
        {panels.chatCollapsed ? (
          <PanelRail
            side="right"
            label={t("panels.expandChat")}
            onExpand={() => updatePanels({ chatCollapsed: false })}
          />
        ) : (
          <>
            <PanelDivider
              grows="left"
              width={widths.chat}
              min={PANEL_BOUNDS.chat.min}
              max={PANEL_BOUNDS.chat.max}
              label={t("panels.chatDivider")}
              onResize={(chatWidth) => updatePanels({ chatWidth })}
            />
            <ChatPanel
              width={widths.chat}
              onCollapse={() => updatePanels({ chatCollapsed: true })}
              models={chatModels}
              selectedId={activeModel?.id ?? null}
              onSelectModel={setChosenModel}
              turns={chat.turns}
              streaming={chat.streaming}
              error={chat.error}
              reasoning={chat.reasoning}
              onSend={(text) => void chat.send(text)}
              onStop={() => void chat.stop()}
              onClear={() => {
                // A cleared thread is a new conversation: the next save must make a new chat rather
                // than overwrite the one that was open.
                history.forget();
                setMissingChatFile(null);
                chat.clear();
              }}
              onConfigure={() => setPrefsOpen(true)}
              resolveEdit={resolveAgainstDocument}
              onApplyEdit={applyEdit}
              chats={history.chats}
              openChatId={history.openId}
              missingFile={missingChatFile}
              onSaveChat={() =>
                void history.save(chat.turns, activeModel?.id ?? null, state.file?.path ?? null)
              }
              onOpenChat={(id) => void openChat(id)}
              onDeleteChat={(id) => void history.remove(id)}
            />
          </>
        )}
      </div>

      <PreferencesDialog
        open={prefsOpen}
        settings={settings}
        isDesktop={isDesktop()}
        keyedEndpoints={keyedEndpoints}
        onClose={() => setPrefsOpen(false)}
        onChange={update}
        onSaveKey={saveKey}
        onDeleteKey={deleteKey}
      />

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}
