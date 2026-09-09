/// One line-drawn mark, on the app's terms.
///
/// Every icon in the interface is a stroke of `currentColor` on a 24-unit grid, so a mark takes the
/// colour of the text it sits beside and needs nothing said about it at the call site. Shared rather
/// than declared per file: two copies of this would eventually disagree about stroke width, and the
/// one that was wrong would be the one nobody looked at.
///
/// **Decorative, always.** `aria-hidden` is not a prop, because there is no case here for a mark
/// that carries meaning on its own - every one of them sits next to a label that says the same
/// thing. A mark with no label is a mark nobody can read out.
export default function Glyph({
  className = "size-3.5",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}
