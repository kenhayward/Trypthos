interface Props {
  profileLabel: string | null;
}

/// Right panel: AI chat.
///
/// Placeholder for the panel ported from Diariz. The provider call happens in the MAIN process and
/// streams back over IPC - the renderer never holds an API key and never opens a socket to a
/// provider, because a key in the renderer is a key in devtools and in any renderer crash dump.
export default function ChatPanel({ profileLabel }: Props) {
  return (
    <aside
      aria-label="Chat"
      className="flex w-80 shrink-0 flex-col border-l border-neutral-200 bg-neutral-50"
    >
      <h2 className="border-b border-neutral-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Chat
      </h2>
      <div className="grow p-3 text-sm text-neutral-600">
        {profileLabel ? `Ready with ${profileLabel}.` : "Configure an endpoint and model to start."}
      </div>
    </aside>
  );
}
