import { useTranslation } from "react-i18next";
import { APP_NAME, APP_VERSION, CAPABILITIES, DISCLAIMERS } from "../lib/appInfo";
import { renderMarkdown } from "../lib/markdown";

interface Props {
  open: boolean;
  onClose: () => void;
}

/// Reads lib/appInfo only. It must never import the release notes: doing so would pull the release
/// history into the initial bundle, since the About box is eager.
export default function AboutModal({ open, onClose }: Props) {
  const { t } = useTranslation();

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("app.about", { version: APP_VERSION })}
      className="fixed inset-0 flex items-center justify-center bg-[rgba(15,23,42,0.45)] p-4"
    >
      <div className="max-h-full w-full max-w-lg overflow-auto rounded-lg bg-app p-6 shadow-xl">
        <h1 className="text-lg font-semibold text-ink">{APP_NAME}</h1>
        <p className="mt-1 text-sm text-ink-4">{t("about.version", { version: APP_VERSION })}</p>

        <div
          className="markdown-body mt-4 text-xs text-ink-3"
          // The capability summary is authored as a markdown table, and was being shown verbatim -
          // pipes, separator row and all - because it went into a `<pre>`. Same renderer as Preview
          // mode and the chat panel, and the same styling, rather than a third way of drawing a
          // table.
          //
          // Sanitised in renderMarkdown like every other rendered surface. This string ships with
          // the app rather than arriving from anywhere, so it is not untrusted - but a second
          // pipeline that skipped sanitising would be one somebody could later point at something
          // that is.
          dangerouslySetInnerHTML={{ __html: renderMarkdown(CAPABILITIES) }}
        />

        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-ink-4">
          {DISCLAIMERS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        <button
          type="button"
          onClick={onClose}
          className="mt-6 rounded bg-accent-strong px-3 py-1.5 text-sm text-white"
        >
          {t("about.close")}
        </button>
      </div>
    </div>
  );
}
