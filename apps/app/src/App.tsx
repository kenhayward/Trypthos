import { useState } from "react";
import AboutModal from "./components/AboutModal";
import ChatPanel from "./components/ChatPanel";
import EditorPanel from "./components/EditorPanel";
import WorkspacePanel from "./components/WorkspacePanel";
import { APP_NAME, APP_VERSION } from "./lib/appInfo";

/// Stand-in document until the workspace backend can open a real file.
///
/// A scratch buffer rather than a fake file: nothing here pretends to be on disk, so there is no
/// save path to be wrong about yet.
const SCRATCH = `# Scratch buffer

No folder is open yet, so this text lives only in memory.

Switch between **Source** and **Preview** above. The text is the same in both:
a mode is a view, never a transform.

- Source shows every character, colour-coded by role
- Preview renders it as prose

> Live mode, which hides markers except on the line your cursor is on, comes next.

Inline \`code\` and a [link](https://example.com) render too.
`;

/// The three-panel shell: workspace browser, editor, chat.
export default function App() {
  const [aboutOpen, setAboutOpen] = useState(false);
  const [document, setDocument] = useState(SCRATCH);

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

      <div className="flex min-h-0 grow">
        <WorkspacePanel workspaceName={null} />
        <EditorPanel fileName={null} value={document} onChange={setDocument} />
        <ChatPanel profileLabel={null} />
      </div>

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}
