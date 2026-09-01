import { useState } from "react";
import AboutModal from "./components/AboutModal";
import ChatPanel from "./components/ChatPanel";
import EditorPanel from "./components/EditorPanel";
import WorkspacePanel from "./components/WorkspacePanel";
import { APP_NAME, APP_VERSION } from "./lib/appInfo";

/// The three-panel shell: workspace browser, editor, chat.
export default function App() {
  const [aboutOpen, setAboutOpen] = useState(false);

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
        <EditorPanel fileName={null} />
        <ChatPanel profileLabel={null} />
      </div>

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}
