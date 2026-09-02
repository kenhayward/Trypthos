import { useTranslation } from "react-i18next";

interface Props {
  width: number;
  onCollapse: () => void;
  profileLabel: string | null;
}

/// Right panel: AI chat.
///
/// Placeholder for the panel ported from Diariz. The provider call happens in the MAIN process and
/// streams back over IPC - the renderer never holds an API key and never opens a socket to a
/// provider, because a key in the renderer is a key in devtools and in any renderer crash dump.
export default function ChatPanel({ width, onCollapse, profileLabel }: Props) {
  const { t } = useTranslation();

  return (
    <aside
      aria-label={t("chat.title")}
      style={{ width }}
      className="flex shrink-0 flex-col overflow-hidden bg-panel"
    >
      <h2 className="flex items-center gap-1 border-b border-rule px-3 py-2 text-xs font-semibold tracking-wide text-ink-4 uppercase">
        {t("chat.title")}
        <button
          type="button"
          onClick={onCollapse}
          aria-label={t("panels.collapseChat")}
          title={t("panels.collapseChat")}
          className="ml-auto rounded p-1 text-ink-4 hover:bg-hover hover:text-ink"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </h2>
      <div className="grow p-3 text-sm text-ink-3">
        {profileLabel
          ? t("chat.ready", { profile: profileLabel })
          : t("chat.notConfigured")}
      </div>
    </aside>
  );
}
