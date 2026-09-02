import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import AboutModal from "./components/AboutModal";
import ChatPanel from "./components/ChatPanel";
import EditorPanel from "./components/EditorPanel";
import TitleBar from "./components/TitleBar";
import WorkspacePanel from "./components/WorkspacePanel";
import { useWorkspace } from "./hooks/useWorkspace";
import { workspaceClient } from "./lib/workspaceClient";
import { currentPlatform } from "./lib/windowControls";

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
  const client = useMemo(() => workspaceClient(), []);
  const platform = useMemo(() => currentPlatform(), []);
  const { state, actions } = useWorkspace(client, SCRATCH);

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

  return (
    <div className="flex h-full flex-col bg-app text-ink">
      <TitleBar
        platform={platform}
        fileName={state.file?.name ?? null}
        onAbout={() => setAboutOpen(true)}
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

      <div className="flex min-h-0 grow">
        <WorkspacePanel
          workspaceName={state.workspace?.name ?? null}
          directory={state.directory}
          nodes={state.nodes}
          openFilePath={state.file?.path ?? null}
          busy={state.busy}
          onOpenWorkspace={() => void actions.open()}
          onEnter={(directory) => void actions.enter(directory)}
          onGoUp={() => void actions.goUp()}
          onOpenFile={(node) => void actions.openFile(node)}
        />
        <EditorPanel
          workspaceName={state.workspace?.name ?? null}
          filePath={state.file?.path ?? null}
          dirty={state.dirty}
          value={state.content}
          onChange={actions.edit}
        />
        <ChatPanel profileLabel={null} />
      </div>

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}
