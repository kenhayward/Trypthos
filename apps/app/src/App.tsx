import { useEffect, useMemo, useState } from "react";
import AboutModal from "./components/AboutModal";
import ChatPanel from "./components/ChatPanel";
import EditorPanel from "./components/EditorPanel";
import WorkspacePanel from "./components/WorkspacePanel";
import { useWorkspace } from "./hooks/useWorkspace";
import { APP_NAME, APP_VERSION } from "./lib/appInfo";
import { workspaceClient } from "./lib/workspaceClient";

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
  const [aboutOpen, setAboutOpen] = useState(false);
  const client = useMemo(() => workspaceClient(), []);
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
    <div className="flex h-full flex-col bg-white text-neutral-900">
      <header className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
        <span className="text-sm font-semibold">{APP_NAME}</span>
        <button
          type="button"
          onClick={() => setAboutOpen(true)}
          className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100"
        >
          About {APP_VERSION}
        </button>
      </header>

      {state.error !== null && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          <span>{state.error}</span>
          <button
            type="button"
            onClick={actions.dismissError}
            className="shrink-0 rounded px-1.5 text-amber-700 hover:bg-amber-100"
          >
            Dismiss
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
          fileName={state.file ? `${state.file.name}${state.dirty ? " *" : ""}` : null}
          value={state.content}
          onChange={actions.edit}
        />
        <ChatPanel profileLabel={null} />
      </div>

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}
