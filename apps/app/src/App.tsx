import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  PANEL_BOUNDS,
  chatPanelVisible,
  contextTokens,
  defaultChatProfile,
  cappedForSaving,
  effectiveSystemPrompt,
  fileTypeFor,
  noteRecentFile,
  parseChatCommand,
  resolveEdit,
  resolvePanelWidths,
  splitQualified,
  type FindMatch,
  type ProposedEdit,
} from "@trypthos/domain";
import ChatPanel from "./components/ChatPanel";
import NewFileDialog from "./components/NewFileDialog";
import FindDialog from "./components/FindDialog";
import EditorPanel from "./components/EditorPanel";
import type { EditorHandle, EditorSelection } from "./components/DocumentEditor";
import PanelDivider from "./components/PanelDivider";
import PanelRail from "./components/PanelRail";
import SettingsDialog from "./components/SettingsDialog";
import TitleBar from "./components/TitleBar";
import WorkspacePanel from "./components/WorkspacePanel";
import { useApiKeys } from "./hooks/useApiKeys";
import { useChat } from "./hooks/useChat";
import { useChatHistory } from "./hooks/useChatHistory";
import { useChatScope } from "./hooks/useChatScope";
import { useExplorerIntegration } from "./hooks/useExplorerIntegration";
import { useSettings } from "./hooks/useSettings";
import { useTheme } from "./hooks/useTheme";
import { useWorkspace } from "./hooks/useWorkspace";
import { useFileFilter } from "./hooks/useFileFilter";
import { useFind } from "./hooks/useFind";
import { builtInTitleKey } from "./lib/builtInDocuments";
import { answerFor } from "./lib/commandAnswers";
import { openExternal } from "./lib/externalLinks";
import { MARKDOWN_GUIDE } from "./lib/markdownGuide";

import { followLink, markdownLinkHandler } from "./lib/markdownLinks";
import type { SettingsSection } from "./lib/settingsSections";
import {
  chatBridge,
  chatHistoryBridge,
  integrationBridge,
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

/// Which folder the document on screen came from, for the tab strip's hover text.
///
/// A path names its workspace, so this is a lookup rather than a guess - and it answers null for a
/// document that is in no folder at all: the scratch buffer, a draft, the built-in guide.
function workspaceNameFor(
  workspaces: readonly { id: string; name: string }[],
  activePath: string | null,
): string | null {
  const workspaceId = activePath === null ? null : splitQualified(activePath)?.workspaceId;
  if (workspaceId === undefined || workspaceId === null) return null;
  return workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? null;
}

/// The release-notes window, fetched when it is opened and not before.
///
/// `lazy` rather than an ordinary import, and the one thing keeping the release history out of what
/// loads with the app: the archive alone holds every release ever made and grows without bound.
/// `bundleBoundary.test.ts` asserts the module graph, because a static import of it here would look
/// entirely correct and cost every page load.
const ReleaseNotes = lazy(() => import("./pages/ReleaseNotes"));

/// Hoisted, not written inline: it is handed to the editor as a prop that an effect keys on, and a
/// fresh `[]` per render would dispatch into CodeMirror on every keystroke.
const NO_MATCHES: readonly FindMatch[] = [];

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
  /// True while File > New is asking for a name. Nothing is created until it answers.
  const [namingFile, setNamingFile] = useState(false);
  /// True while the release notes are open. Its own flag rather than a settings page: the notes are
  /// lazily loaded, and the settings dialog is eager.
  const [readingNotes, setReadingNotes] = useState(false);
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

  /// Whether Trypthos is in File Explorer's right-click menu. Asked of the shell rather than stored,
  /// because the registry is the record - see the hook.
  const explorer = useExplorerIntegration(useMemo(() => integrationBridge(), []));


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
  /// Records a file the user opened, for the File menu's recent list.
  ///
  /// Written into settings because that is where everything the app remembers between launches
  /// lives, and because the main process - which draws the menu - is already told when settings are
  /// written. The functional form matters: two files opened in quick succession would otherwise both
  /// prepend to the list as it was before either.
  const noteRecent = useCallback(
    (file: { root: string; path: string }) =>
      update((prev) => ({ recentFiles: noteRecentFile(prev.recentFiles, file) })),
    [update],
  );

  const { state, actions } = useWorkspace(client, SCRATCH, confirmDiscard, noteRecent);

  /// The browser's filter box, which searches every open folder by name.
  ///
  /// Its own hook rather than part of the workspace state: what it holds is a question in flight -
  /// a timer, and an answer that may already be stale - and none of that belongs beside the
  /// documents and their unsaved work.
  const fileFilter = useFileFilter({
    workspaces: state.workspaces,
    filterFiles: (request) => client.filterFiles(request),
  });

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

  /// Find, and Find in Files.
  ///
  /// Here rather than inside the editor panel, because the two searches need different halves of
  /// this level: one needs the text of the document on screen, and the other needs the folder
  /// selected in the browser and the ability to open a file in a tab. Neither is the editor's to
  /// know about.
  const find = useFind({
    content: state.content,
    activePath: state.activePath,
    selectedFolder: state.selectedFolder,
    fileTypes: settings.fileTypes.enabled,
    findInFiles: (request) => client.findInFiles(request),
    openPath: (path) => actions.openPath(path),
  });

  /// What chat may see, read when a turn is sent so it reflects the buffer as it is then.
  ///
  /// `state.content` rather than the file on disk: once the user has typed, the file is not what
  /// they are looking at.
  const scopeSource = useCallback(
    () => ({
      selection: selection.current.text,
      file:
        // A picture is not a document to answer about, and it has no text to send: `content` is
        // empty for one by design. Treated as nothing open rather than as an empty file, which would
        // tell the model something untrue about it.
        state.file === null || state.media !== null
          ? null
          : {
              path: state.file.path,
              content: state.content,
              // Resolved from the same catalogue and the same setting the tree filters on, so what
              // chat is told a file is cannot disagree with what the editor is drawing.
              fileType: fileTypeFor(state.file.name, settings.fileTypes.enabled)?.id ?? null,
            },
    }),
    [state.file, state.content, state.media, settings.fileTypes.enabled],
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
  const scope = useChatScope(scopeBridge, scopeSource, state.selectedFolder);

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

  // Reopening the folders the app was last closed with. Only once, and only after settings have
  // been read - before that `workspaces` is the default, which is empty.
  const reopened = useRef(false);
  useEffect(() => {
    if (!loaded || reopened.current) return;
    reopened.current = true;
    if (settings.workspaces.length > 0) void actions.reopen(settings.workspaces);
  }, [loaded, settings.workspaces, actions]);

  /// What to reopen next time: every folder that is open, in the order they are on screen.
  ///
  /// Written only when the list actually differs, and compared by value rather than by reference:
  /// the state's array is rebuilt on every render, so an identity check would write the settings
  /// file on each one.
  useEffect(() => {
    if (!loaded) return;
    const roots = state.workspaces.map((workspace) => workspace.root);
    const same =
      roots.length === settings.workspaces.length &&
      roots.every((root, at) => root === settings.workspaces[at]);
    if (!same) update({ workspaces: roots });
  }, [loaded, state.workspaces, settings.workspaces, update]);

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

  // Ctrl+S / Cmd+S, Ctrl+Shift+S / Cmd+Shift+S, and Ctrl+W / Cmd+W. Bound on the window rather than
  // inside the editor so they work wherever focus is, and preventDefault matters: the browser's own
  // save dialog, and its close of the whole tab, would otherwise happen over the app.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;

      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        // Shift decides which, and the two write to different places: a Save As read as a Save would
        // put the document over the file the user was trying to keep.
        if (event.shiftKey) void actions.saveAs();
        else void actions.save();
      } else if (key === "f") {
        // Taken from the browser's own find, which would search the app's chrome rather than the
        // document - and cannot see a line CodeMirror has not drawn.
        event.preventDefault();
        find.openFind();
      } else if (key === "w" && state.activePath !== null) {
        // Only with a document open. Otherwise this is the shell's own "close the window", and
        // swallowing it would leave the shortcut doing nothing at all.
        event.preventDefault();
        void actions.closeFile(state.activePath);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions, state.activePath, find]);

  // A folder or a file the app was launched with, from File Explorer's right-click menu. It arrives
  // here rather than being acted on in the shell because this side owns the open documents, and is
  // the only one that can ask about unsaved work before another folder replaces them.
  useEffect(
    () => windowControls().onOpenTarget((target) => void actions.openTarget(target)),
    [actions],
  );

  // Menu items the renderer carries out.
  //
  // Each one drives the path the user already has - the same open, save, preferences and about the
  // buttons and shortcuts use - rather than a second copy of it. That is the whole reason the menu
  // sends an ACTION rather than doing the work in the main process: there is one implementation of
  // each, and the menu is another way to reach it.
  useEffect(
    () =>
      windowControls().onMenuAction((action) => {
        if (action === "new-file") setNamingFile(true);
        else if (action === "find") find.openFind();
        else if (action === "open-folder") void actions.open();
        else if (action === "save") void actions.save();
        else if (action === "save-as") void actions.saveAs();
        else if (action === "preferences") setSettingsOn("appearance");
        else if (action === "about") setSettingsOn("about");
        else if (action === "markdown-guide") actions.openGuide(MARKDOWN_GUIDE);
        else if (action === "release-notes") setReadingNotes(true);
        // The escape hatch for a list full of files that have since moved. Nothing walks the disk to
        // check, so an entry stays until it falls off the end or this is chosen.
        else if (action === "clear-recent") update({ recentFiles: [] });
      }),
    [actions, update, find],
  );

  /// Clicking a link in rendered markdown - Preview mode, a chat reply, the About box.
  ///
  /// One handler for the whole window rather than a callback threaded into each surface that renders
  /// markdown. Delegated because the HTML is injected wholesale and there are no React elements to
  /// bind to, and placed here because this is the level that has both halves of the answer: which
  /// document is open, so a relative link resolves the way its author meant, and how to open
  /// another one. It matches on the mark `renderMarkdown` puts on its own anchors, so an anchor the
  /// app draws itself is left entirely alone.
  /// Which folder a link with no folder of its own belongs to.
  ///
  /// The document on screen when there is one, then the folder chosen in the browser, then the first
  /// open folder. All three are the same answer nearly always; they differ when somebody is reading
  /// the scratch buffer or a chat reply with several folders open, which is exactly when a bare path
  /// needs telling apart.
  const linkWorkspaceId = useMemo(() => {
    const fromDocument = splitQualified(state.activePath ?? "")?.workspaceId;
    const fromSelection = splitQualified(state.selectedFolder)?.workspaceId;
    return fromDocument ?? fromSelection ?? state.workspaces[0]?.id ?? null;
  }, [state.activePath, state.selectedFolder, state.workspaces]);

  const linkHandlers = useMemo(
    () => ({
      fromPath: state.file?.path ?? null,
      fileTypes: settings.fileTypes.enabled,
      workspaceId: linkWorkspaceId,
      openDocument: (path: string) => void actions.openPath(path),
      openExternal,
    }),
    [state.file?.path, settings.fileTypes.enabled, linkWorkspaceId, actions],
  );
  const onMarkdownLink = useMemo(() => markdownLinkHandler(linkHandlers), [linkHandlers]);

  /// What the window is called after the app's own name: the file on screen, or the built-in
  /// document's title. Its path is not a name a user would recognise.
  const titleKey = builtInTitleKey(state.activePath);
  const documentTitle = titleKey === null ? (state.file?.name ?? null) : t(titleKey);

  return (
    <div className="flex h-full flex-col bg-app text-ink" onClick={onMarkdownLink}>
      <TitleBar platform={platform} fileName={documentTitle} />

      {state.errorKey !== null && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 border-b border-rule bg-sunken px-3 py-2 text-sm text-ink-2"
        >
          <span>{t(state.errorKey, state.errorParams ?? undefined)}</span>
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
          workspaces={state.workspaces}
          folders={state.folders}
          filter={fileFilter.filter}
          filterStatus={fileFilter.status}
          activePath={state.activePath}
          openPaths={openPaths}
          dirtyPaths={state.dirtyPaths}
          onOpenWorkspace={() => void actions.open()}
          onFilterChange={fileFilter.setFilter}
          onToggleFolder={(path) => void actions.toggleFolder(path)}
          onRetryFolder={(path) => void actions.retryFolder(path)}
          onOpenFile={(node) => void actions.openFile(node)}
          fileTypes={settings.fileTypes.enabled}
          selectedFolder={state.selectedFolder}
          onSelectFolder={actions.selectFolder}
          onCloseWorkspace={(workspaceId) => void actions.closeWorkspace(workspaceId)}
          onOpenFileTypes={() => setSettingsOn("fileTypes")}
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
          workspaceName={workspaceNameFor(state.workspaces, state.activePath)}
          paths={openPaths}
          activePath={state.activePath}
          dirtyPaths={state.dirtyPaths}
          dirty={state.dirty}
          value={state.content}
          readOnly={state.readOnly}
          media={state.media}
          defaultMode={settings.editor.defaultViewMode}
          fileTypes={settings.fileTypes.enabled}
          onActivateFile={actions.activateFile}
          onCloseFile={(path) => void actions.closeFile(path)}
          onCloseFiles={(paths) => void actions.closeFiles(paths)}
          onSelectionChange={(next) => (selection.current = next)}
          // The same rule the rendered surfaces get, reached the other way: CodeMirror draws link
          // text as a decorated span rather than an anchor, so the delegated handler above cannot
          // see it and the editor reports the click instead.
          onFollowLink={(href) => followLink(href, linkHandlers)}
          ref={editor}
          onChange={actions.edit}
          // Only for the document the matches were found in. Switching to another tab must not leave
          // one file's offsets painted over another file's text.
          matches={find.highlight.path === state.activePath ? find.highlight.matches : NO_MATCHES}
          activeMatch={find.highlight.path === state.activePath ? find.highlight.active : -1}
          overlay={
            find.open ? (
              <FindDialog
                tab={find.tab}
                onTabChange={find.setTab}
                query={find.query}
                onQueryChange={find.setQuery}
                regex={find.regex}
                onRegexChange={find.setRegex}
                caseSensitive={find.caseSensitive}
                onCaseSensitiveChange={find.setCaseSensitive}
                position={find.position}
                onMove={find.setPosition}
                scope={state.workspaces.length === 0 ? null : find.scope}
                status={find.status}
                onSearch={() => void find.search()}
                onStep={(step) => void find.step(step)}
                onClose={find.close}
              />
            ) : null
          }
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
          fileTypes={settings.fileTypes.enabled}
                linkWorkspaceId={linkWorkspaceId}
                streaming={chat.streaming}
                error={chat.error}
                activity={chat.activity}
                context={{ tokens: carried, limit: activeModel?.contextWindow ?? null }}
                onSend={(text) => {
                  // A slash command is answered here rather than sent. The check is deliberately
                  // strict - see `parseChatCommand` - so a question that merely begins with a slash
                  // still reaches the model rather than being quietly swallowed.
                  const command = parseChatCommand(text);
                  const answer = command === null ? null : answerFor(command, t);
                  if (answer !== null) chat.answerLocally(text.trim(), answer);
                  else void chat.send(text);
                }}
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
            folderPath: state.selectedFolder,
                  canUseFolder: state.workspaces.length > 0,
                  onToggleFolder: scope.setIncludeFolder,
                  onNeedFiles: () => void scope.loadFiles(),
                  onAttach: (path) => void scope.attach(path),
                  onDetach: scope.detach,
                }}
                onSaveChat={() =>
                  // The panel's turns, not the wire ones: a saved chat is a record of what was
                  // shown, so it keeps the thinking and the files each reply read. Capped on the
                  // way, because chain of thought is often longer than the answer.
                  void history.save(
                    cappedForSaving(chat.turns),
                    activeModel?.id ?? null,
                    state.file?.path ?? null,
                  )
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
          explorer={explorer}
        />
      )}

      {readingNotes && (
        // No fallback of its own: the window is one local chunk, so a placeholder over the whole app
        // would be a flash of something nobody reads. Until it arrives the app is simply still there.
        <Suspense fallback={null}>
          <ReleaseNotes onClose={() => setReadingNotes(false)} />
        </Suspense>
      )}

      {namingFile && (
        <NewFileDialog
          fileTypes={settings.fileTypes.enabled}
          onCancel={() => setNamingFile(false)}
          onCreate={(name) => {
            setNamingFile(false);
            actions.newDocument(name);
          }}
        />
      )}
    </div>
  );
}
