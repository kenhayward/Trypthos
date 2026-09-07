import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { FindMatch } from "@trypthos/domain";

/// Highlighting what Find found.
///
/// A state field rather than a view plugin, unlike Live mode: Live derives its decorations FROM the
/// document, so it recomputes whenever the document changes, while these come from outside it - a
/// dialog that ran a search. Nothing in the editor can work them out, so they are put in and kept.
///
/// They are also mapped through every change, which is what a state field gives for free: type a
/// character above a highlighted match and the highlight moves with the text rather than staying
/// where the character used to be.

export interface FoundMatches {
  matches: readonly FindMatch[];
  /// Which of them is the one the reader is on, or -1 for none. Drawn differently, because "there
  /// are twelve matches" and "you are looking at the fourth" are different things to say.
  active: number;
}

export const NO_MATCHES: FoundMatches = { matches: [], active: -1 };

/// Replaces what is highlighted. One effect for both halves, because they always change together -
/// a new search sets both, and stepping to the next match sets both.
export const setFoundMatches = StateEffect.define<FoundMatches>();

const match = Decoration.mark({ class: "cm-find-match" });
const activeMatch = Decoration.mark({ class: "cm-find-match cm-find-active" });

function decorationsFor(found: FoundMatches, length: number): DecorationSet {
  return Decoration.set(
    found.matches
      // Clamped and dropped rather than trusted. A search answers against the text as it was, and
      // the document can have been edited since - an out-of-range decoration throws inside
      // CodeMirror and takes the centre panel down with it.
      .filter((range) => range.from >= 0 && range.to <= length && range.to > range.from)
      .map((range, index) =>
        (index === found.active ? activeMatch : match).range(range.from, range.to),
      ),
    // Sorted for us: the matcher walks the text forwards, but a filter that dropped one would not
    // renumber, so this is what keeps `active` pointing at the right decoration.
    true,
  );
}

export const foundMatches = StateField.define<FoundMatches>({
  create: () => NO_MATCHES,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setFoundMatches)) return effect.value;
    }
    if (!transaction.docChanged) return value;

    // Moved with the text they are on. An edit anywhere above a match shifts it, and a highlight
    // left at a stale offset would sit over the wrong words - which is worse than no highlight,
    // because it looks like an answer.
    return {
      active: value.active,
      matches: value.matches.map((range) => ({
        from: transaction.changes.mapPos(range.from),
        to: transaction.changes.mapPos(range.to),
      })),
    };
  },
});

const decorations = EditorView.decorations.compute([foundMatches], (state) =>
  decorationsFor(state.field(foundMatches), state.doc.length),
);

/// The colours, from tokens like everything else - `editorTheme` reads the same variables as the
/// chrome around it, and a hex here would be a second palette that only matched in one theme.
const findTheme = EditorView.theme({
  ".cm-find-match": {
    backgroundColor: "var(--color-find-match)",
    borderRadius: "2px",
  },
  ".cm-find-active": {
    backgroundColor: "var(--color-find-active)",
    // An outline as well as a colour: the one you are on has to be findable at a glance in a
    // document where a dozen others are highlighted, and colour alone is not enough for everyone.
    outline: "1px solid var(--color-find-active-edge)",
  },
});

export const findHighlighting: Extension = [foundMatches, decorations, findTheme];
