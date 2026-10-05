import Glyph from "./Glyph";

/// The mark for "this is being fetched", on the app's terms: the circular arrow, turning.
///
/// One component because the tree, the folder picker and the graph page all say the same thing, and
/// three spinners would turn at three speeds. `motion-safe:` rather than a bare `animate-spin`, so a
/// reader who has asked their system for less motion gets a still mark instead of a spinning one -
/// the label still says what is happening.
///
/// `label` is required: the glyph is decorative by design (see `Glyph`), so the status role is what
/// a screen reader hears. Say what is loading, not that something is.
export default function Spinner({ label, className = "" }: { label: string; className?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={`inline-flex shrink-0 text-ink-4 ${className}`.trim()}
    >
      <Glyph className="size-3 motion-safe:animate-spin">
        <path d="M20 12a8 8 0 1 1-2.34-5.66" />
        <path d="M20 4v5h-5" />
      </Glyph>
    </span>
  );
}
