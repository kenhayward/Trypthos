import { useTranslation } from "react-i18next";

interface Props {
  profileLabel: string | null;
}

/// Right panel: AI chat.
///
/// Placeholder for the panel ported from Diariz. The provider call happens in the MAIN process and
/// streams back over IPC - the renderer never holds an API key and never opens a socket to a
/// provider, because a key in the renderer is a key in devtools and in any renderer crash dump.
export default function ChatPanel({ profileLabel }: Props) {
  const { t } = useTranslation();

  return (
    <aside
      aria-label={t("chat.title")}
      className="flex w-80 shrink-0 flex-col border-l border-rule bg-panel"
    >
      <h2 className="border-b border-rule px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-4">
        {t("chat.title")}
      </h2>
      <div className="grow p-3 text-sm text-ink-3">
        {profileLabel
          ? t("chat.ready", { profile: profileLabel })
          : t("chat.notConfigured")}
      </div>
    </aside>
  );
}
