import { useTranslation } from "react-i18next";
import { APP_NAME, APP_VERSION, CAPABILITIES, DISCLAIMERS } from "../lib/appInfo";
import { renderMarkdown } from "../lib/markdown";

/// About, as a page of the settings dialog.
///
/// Reads `lib/appInfo` and nothing else. It must never import the release notes: doing so would pull
/// the release history into the initial bundle, since the settings dialog is eager.
///
/// There is one About surface, not two. The capability table is kept in step with the README and
/// `docs/features.md` by hand, so a second copy of it somewhere else in the app is a third thing to
/// remember and the first one to go stale.
export default function SettingsAbout() {
  const { t } = useTranslation();

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3">
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-10 shrink-0 text-leaf"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>

        <div>
          <h2 className="text-xl font-semibold text-ink">{APP_NAME}</h2>
          <p className="text-xs text-ink-4">{t("about.version", { version: APP_VERSION })}</p>
        </div>
      </div>

      <p className="mt-3 text-base text-ink-3">{t("settings.about.tagline")}</p>

      <div
        className="markdown-body mt-5 text-xs text-ink-3"
        // The capability summary is authored as a markdown table, and was once shown verbatim -
        // pipes, separator row and all - because it went into a `<pre>`. Same renderer as Preview
        // mode and the chat panel, and the same styling, rather than a third way of drawing a table.
        //
        // Sanitised in renderMarkdown like every other rendered surface. This string ships with the
        // app rather than arriving from anywhere, so it is not untrusted - but a second pipeline
        // that skipped sanitising would be one somebody could later point at something that is.
        dangerouslySetInnerHTML={{ __html: renderMarkdown(CAPABILITIES) }}
      />

      <ul className="mt-5 list-disc space-y-1 pl-5 text-xs text-ink-4">
        {DISCLAIMERS.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
