interface Props {
  fileName: string | null;
}

/// Centre panel: the editor.
///
/// Placeholder for the CodeMirror 6 surface. When it lands, Live, Source and Preview are decoration
/// sets over ONE document - a mode is a view, never a transform, and switching one must never write.
export default function EditorPanel({ fileName }: Props) {
  return (
    <main aria-label="Editor" className="flex min-w-0 grow flex-col bg-white">
      <h2 className="border-b border-neutral-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {fileName ? fileName : "Editor"}
      </h2>
      <div className="grow p-4 font-mono text-sm text-neutral-500">
        Open a file to start editing.
      </div>
    </main>
  );
}
