import { useTranslation } from "react-i18next";
import type { EditTarget, ProposedEdit } from "@trypthos/domain";

export type EditState = "offered" | "applied";

interface Props {
  edit: ProposedEdit;
  /// Where the edit would land in the document AS IT IS NOW, or why it cannot.
  ///
  /// Resolved fresh on every render rather than when the reply arrived: the user may have renamed
  /// the heading while reading the proposal, and a card still offering Apply would then write
  /// somewhere nobody chose.
  target: EditTarget;
  state: EditState;
  onApply: () => void;
}

/// One change the model has proposed.
///
/// **Nothing is written until this is clicked**, and that is a security property rather than a
/// courtesy. The user's document is in the model's context, and a markdown file can contain text
/// addressed at an assistant - so an edit that applied itself would make "treat file contents as
/// data" unenforceable. A person between the injection and the file is what the rule rests on.
export default function ChatEditCard({ edit, target, state, onApply }: Props) {
  const { t } = useTranslation();

  /// Written as a switch of literal keys rather than one computed key.
  ///
  /// `i18nKeys.test.ts` scans for `t("...")` and cannot see a template literal, so a computed key is
  /// a key the guard stops protecting - and a missing one renders as `chat.edit.insertBefore` sitting
  /// in the interface, which throws nothing and breaks no other test.
  const describe = () => {
    const heading = { heading: edit.heading ?? "" };
    switch (edit.op) {
      case "insert-before":
        return t("chat.edit.insertBefore", heading);
      case "insert-after":
        return t("chat.edit.insertAfter", heading);
      case "replace-section":
        return t("chat.edit.replaceSection", heading);
      case "replace-selection":
        return t("chat.edit.replaceSelection");
      case "append":
        return t("chat.edit.append");
    }
  };

  const cannot = (reason: Exclude<EditTarget, { ok: true }>["reason"]) => {
    switch (reason) {
      case "heading-not-found":
        return t("chat.edit.cannotFindHeading");
      case "heading-ambiguous":
        return t("chat.edit.headingAmbiguous");
      case "no-selection":
        return t("chat.edit.noSelection");
    }
  };

  return (
    <div className="rounded-lg border border-rule bg-app">
      <div className="flex items-center gap-2 border-b border-rule px-3 py-1.5">
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-3.5 shrink-0 text-ink-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
        </svg>
        <span className="min-w-0 truncate text-xs text-ink-4">{describe()}</span>
      </div>

      {/* The proposed markdown as SOURCE, not rendered. What matters here is exactly what would be
          written into the file, and rendering it would hide the markers that are the point. */}
      <pre className="max-h-64 overflow-auto px-3 py-2 text-xs whitespace-pre-wrap text-ink">
        {edit.content}
      </pre>

      <div className="flex items-center gap-2 border-t border-rule px-3 py-1.5">
        {state === "applied" ? (
          <span className="text-xs text-leaf">{t("chat.edit.applied")}</span>
        ) : target.ok ? (
          <button
            type="button"
            onClick={onApply}
            className="rounded bg-accent-strong px-2 py-1 text-ui text-white"
          >
            {t("chat.edit.apply")}
          </button>
        ) : (
          // Disabled and explained, never disabled and silent: the user needs to know whether to
          // rename a heading back, re-select a passage, or simply copy the text by hand.
          <span className="text-xs text-danger">{cannot(target.reason)}</span>
        )}
      </div>
    </div>
  );
}
