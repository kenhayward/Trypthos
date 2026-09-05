import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  PANEL_BOUNDS,
  chatPanelVisible,
  contextTokens,
  defaultChatProfile,
  effectiveSystemPrompt,
  resolveEdit,
  resolvePanelWidths,
  type ProposedEdit,
} from "@trypthos/domain";
import ChatPanel from "./components/ChatPanel";
import EditorPanel from "./components/EditorPanel";
import type { EditorHandle, EditorSelection } from "./components/MarkdownEditor";
import PanelDivider from "./components/PanelDivider";
import PanelRail from "./components/PanelRail";
import SettingsDialog from "./components/SettingsDialog";
import TitleBar from "./components/TitleBar";
import WorkspacePanel from "./components/WorkspacePanel";
import { useApiKeys } from "./hooks/useApiKeys";
import { useChat } from "./hooks/useChat";
import { useChatHistory } from "./hooks/useChatHistory";
import { useChatScope } from "./hooks/useChatScope";
import { useSettings } from "./hooks/useSettings";
import { useTheme } from "./hooks/useTheme";
import { useWorkspace } from "./hooks/useWorkspace";
import { openExternal } from "./lib/externalLinks";
import { followLink, markdownLinkHandler } from "./lib/markdownLinks";
import type { SettingsSection } from "./lib/settingsSections";
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
  /// The settings page on screen, or null when the dialog is closed.
  ///
  /// One piece of state rather than a boolean per surface: About is a page of the same dialog now,
  /// and everything that opens settings opens it somewhere in particular - the title bar on
  /// Appearance, the Help menu on About, the chat panel's Configure on the models. Mounting only
  /// while open is what makes `openOn` mean "open here" rather than "opened here once".
  const [settingsOn, setSettingsOn] = useState<SettingsSection | null>(null);
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
  /// Whether the chat panel is part of this window at all - see `showPanel` in settings.
  ///
  /// Distinct from collapsed, and it has to be: a collapsed panel leaves a rail to bring it back,
  /// which is exactly what a panel nobody has a model for should not offer.
  const showChat = chatPanelVisible(settings.chat);
  const widths = resolvePanelWidths({
    available,
    workspace: panels.workspaceWidth,
    chat: panels.chatWidth,
    workspaceCollapsed: panels.workspaceCollapsed,
    // The editor takes the whole width when there is no chat panel, which is what collapsing it
    // already means to the layout. One answer rather than two ways of saying nothing is there.
    chatCollapsed: panels.chatCollapsed || !showChat,
  });
  /// The prompt every path shares, or null in the browser preview - where there is nowhere to save
  /// to, so a question about saving would have only one honest answer and no way to act on it.
  /// The name is passed through, not dropped: the prompt is about ONE document among however many
  /// are open, and it can only say which if it is told.
  const confirmDiscard = useMemo(
    () =>
      isDesktop()
        ? (name?: string | null) => windowControls().confirmDiscard(name ?? null)
        : null,
    [],
  );
  const { state, actions } = useWorkspace(client, SCRATCH, confirmDiscard);

  /// The open documents as paths, which is what both the tab strip and the tree ask for. Memoised
  /// rather than mapped inline: a fresh array on every render re-renders both panels on every
  /// keystroke.
  const openPaths = useMemo(
    () => state.documents.map((document) => document.path),
    [state.documents],
  );

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

  /// What chat may see, read when a turn is sent so it reflects the buffer as it is then.
  ///
  /// `state.content` rather than the file on disk: once the user has typed, the file is not what
  /// they are looking at.
  const scopeSource = useCallback(
    () => ({
      selection: selection.current.text,
      file: state.file === null ? null : { path: state.file.path, content: state.content },
    }),
    [state.file, state.content],
  );

  /// The shell calls chat needs for scope. Built once: `client` is chosen at module scope and does
  /// not change, and rebuilding this would re-run the folder walk on every render.
  const scopeBridge = useMemo(
    () =>
      isDesktop()
        ? { workspaceOutline: client.workspaceOutline, readFile: client.readFile }
        : null,
    // `client` is itself memoised once, so this never rebuilds in practice - but naming the
    // dependency keeps the rule satisfied rather than suppressed, and rebuilding would re-run the
    // folder walk, which is the expensive thing here.
    [client],
  );
  const scope = useChatScope(scopeBridge, scopeSource);

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

  const chat = useChat(useMemo(() => chatBridge(), []), activeModel?.id ?? null, scope.context);

  /// What the next request already carries, before anything is typed.
  ///
  /// Memoised because it walks the document and every attachment, and the panel asks for it again on
  /// each keystroke to add the draft. The system prompt is resolved rather than stored: null means
  /// the built-in default, and that default is what will be sent.
  /// Resolved here rather than at send time, which is the one difference from the request itself:
  /// `scope.context` is a callback so that a turn sees the selection and the buffer AS THEY ARE
  /// THEN, and the dial has to answer before that. It re-resolves when the document changes, which
  /// is what makes the ring move as you write - and only while the panel is on screen, since a
  /// hidden dial is a document walk nobody reads.
  const carried = useMemo(
    () =>
      showChat
        ? contextTokens({
            systemPrompt: effectiveSystemPrompt(settings.chat.systemPrompt),
            context: scope.context(),
            turns: chat.turns,
          })
        : 0,
    // `scope` rather than `scope.context`: the rule cannot see that the callback is the only part
    // read, and naming the object satisfies it honestly rather than suppressing it. The callback is
    // memoised on its own inputs, so this recomputes exactly when the context it would build does.
    [showChat, settings.chat.systemPrompt, scope, chat.turns],
  );
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

  // The shell keeps its own copy of the dirty flag, so that a window with nothing to lose closes
  // without asking the renderer anything at all.
  useEffect(() => {
    void windowControls().setDocumentDirty(state.anyDirty);
  }, [state.anyDirty]);

  // The shell asking whether the window may close. It is a question, not an order: this side owns
  // the document and is the only one that can save it, so it answers by closing the window itself.
  useEffect(
    () =>
      windowControls().onCloseRequested(() => {
        void (async () => {
          if (await actions.mayDiscard()) await windowControls().closeWindow(true);
        })();
      }),
    [actions],
  );

  // Ctrl+S / Cmd+S, and Ctrl+W / Cmd+W. Bound on the window rather than inside the editor so they
  // work wherever focus is, and preventDefault matters: the browser's own save dialog, and its close
  // of the whole tab, would otherwise happen over the app.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;

      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        void actions.save();
      } else if (key === "w" && state.activePath !== null) {
        // Only with a document open. Otherwise this is the shell's own "close the window", and
        // swallowing it would leave the shortcut doing nothing at all.
        event.preventDefault();
        void actions.closeFile(state.activePath);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions, state.activePath]);

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
        else if (action === "preferences") setSettingsOn("appearance");
        else if (action === "about") setSettingsOn("about");
      }),
    [actions],
  );

  /// Clicking a link in rendered markdown - Preview mode, a chat reply, the About box.
  ///
  /// One handler for the whole window rather than a callback threaded into each surface that renders
  /// markdown. Delegated because the HTML is injected wholesale and there are no React elements to
  /// bind to, and placed here because this is the level that has both halves of the answer: which
  /// document is open, so a relative link resolves the way its author meant, and how to open
  /// another one. It matches on the mark `renderMarkdown` puts on its own anchors, so an anchor the
  /// app draws itself is left entirely alone.
  const linkHandlers = useMemo(
    () => ({
      fromPath: state.file?.path ?? null,
      openDocument: (path: string) => void actions.openPath(path),
      openExternal,
    }),
    [state.file?.path, actions],
  );
  const onMarkdownLink = useMemo(() => markdownLinkHandler(linkHandlers), [linkHandlers]);

  return (
    <div className="flex h-full flex-col bg-app text-ink" onClick={onMarkdownLink}>
      <TitleBar
        platform={platform}
        fileName={state.file?.name ?? null}
        onAbout={() => setSettingsOn("about")}
        onSettings={() => setSettingsOn("appearance")}
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
          activePath={state.activePath}
          openPaths={openPaths}
          dirtyPaths={state.dirtyPaths}
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
          paths={openPaths}
          activePath={state.activePath}
          dirtyPaths={state.dirtyPaths}
          dirty={state.dirty}
          value={state.content}
          defaultMode={settings.editor.defaultViewMode}
          onActivateFile={actions.activateFile}
          onCloseFile={(path) => void actions.closeFile(path)}
          onSelectionChange={(next) => (selection.current = next)}
          // The same rule the rendered surfaces get, reached the other way: CodeMirror draws link
          // text as a decorated span rather than an anchor, so the delegated handler above cannot
          // see it and the editor reports the click instead.
          onFollowLink={(href) => followLink(href, linkHandlers)}
          ref={editor}
          onChange={actions.edit}
        />
        {showChat &&
          (panels.chatCollapsed ? (
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
                activity={chat.activity}
                context={{ tokens: carried, limit: activeModel?.contextWindow ?? null }}
              onSend={(text) => void chat.send(text)}
                onStop={() => void chat.stop()}
                onClear={() => {
                  // A cleared thread is a new conversation: the next save must make a new chat rather
                  // than overwrite the one that was open.
                  history.forget();
                  setMissingChatFile(null);
                  // A new conversation should not silently inherit the last one's attachments.
                  scope.clear();
                  chat.clear();
                }}
                onConfigure={() => setSettingsOn("chatModels")}
                resolveEdit={resolveAgainstDocument}
                onApplyEdit={applyEdit}
                chats={history.chats}
                openChatId={history.openId}
                missingFile={missingChatFile}
                scope={{
                  attachments: scope.attachments,
                  files: scope.files,
                  includeFolder: scope.includeFolder,
                  canUseFolder: state.workspace !== null,
                  onToggleFolder: scope.setIncludeFolder,
                  onNeedFiles: () => void scope.loadFiles(),
                  onAttach: (path) => void scope.attach(path),
                  onDetach: scope.detach,
                }}
                onSaveChat={() =>
                  void history.save(chat.turns, activeModel?.id ?? null, state.file?.path ?? null)
                }
                onOpenChat={(id) => void openChat(id)}
                onDeleteChat={(id) => void history.remove(id)}
              />
            </>
          ))}
      </div>

      {settingsOn !== null && (
        <SettingsDialog
          openOn={settingsOn}
          settings={settings}
          isDesktop={isDesktop()}
          keyedEndpoints={keyedEndpoints}
          onClose={() => setSettingsOn(null)}
          onChange={update}
          onSaveKey={saveKey}
          onDeleteKey={deleteKey}
        />
      )}
    </div>
  );
}
