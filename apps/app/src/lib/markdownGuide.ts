import guide from "./markdownGuide.md?raw";

/// The built-in markdown syntax guide, as the document the editor opens.
///
/// Kept as a markdown FILE beside this module rather than as a string literal in it. The guide is
/// full of fenced code blocks, and every backtick in a template literal has to be escaped - which
/// makes the one document in the app whose whole purpose is to show markdown clearly the hardest
/// one in the repo to read or edit. Vite's `?raw` import hands it over as text, so what is written
/// is what the user sees.
///
/// It is help, not a feature inventory: it says what a user can type and what happens when they do.
/// The README's feature table, `docs/features.md` and the About box's capability table are the
/// inventories, and they are deliberately not kept in lockstep with this line for line.
export const MARKDOWN_GUIDE = guide;
