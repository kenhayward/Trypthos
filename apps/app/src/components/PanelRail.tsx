import { useTranslation } from "react-i18next";

interface Props {
  side: "left" | "right";
  label: string;
  onExpand: () => void;
}

/// The sliver a collapsed panel leaves behind.
///
/// A collapsed panel that vanishes completely is a panel nobody can bring back - the design's collapse
/// triangle goes with it. This keeps a hit target on the edge, labelled, so the way back is where the
/// way out was.
export default function PanelRail({ side, label, onExpand }: Props) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label={label}
      title={label}
      className={
        side === "left"
          ? "flex w-5 shrink-0 items-start justify-center border-r border-rule bg-panel pt-2 text-ink-4 hover:bg-hover hover:text-ink"
          : "flex w-5 shrink-0 items-start justify-center border-l border-rule bg-panel pt-2 text-ink-4 hover:bg-hover hover:text-ink"
      }
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
        <path d={side === "left" ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} />
      </svg>
      <span className="sr-only">{t("panels.resize")}</span>
    </button>
  );
}
