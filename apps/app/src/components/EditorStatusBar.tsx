import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  effectiveFlavour,
  FLAVOUR_SIGNALS,
  type DetectedFlavour,
  type FlavourChoice,
  type LineEnding,
} from "@trypthos/domain";
import { MODE_HINT_KEYS, type EditorMode } from "../lib/editorMode";
import ContextMenu, { ContextMenuItem } from "./ContextMenu";

interface Props {
  mode: EditorMode;
  /// Translation key for the document's type, so the strip names what the file actually is rather
  /// than always saying Markdown - which it did, on every file, from the moment more than markdown
  /// could be opened.
  fileTypeKey: string;
  lineEnding: LineEnding;
  /// Where the caret is and how long the document is, already formatted.
  ///
  /// Here rather than in the header, which now shares its row with the tab strip: this is where an
  /// editor reports the caret anyway, and the tabs need the width more than the numbers do.
  stats: string;
  /// Which markdown the document is written in, for a markdown document. Absent for anything else,
  /// which takes the chip away.
  flavour?: { detected: DetectedFlavour; choice: FlavourChoice };
  onFlavourChange?: (choice: FlavourChoice) => void;
}

const CHOICES: readonly FlavourChoice[] = ["auto", "gfm", "obsidian"];

/// The strip along the bottom: what this mode does, and what the file actually is.
///
/// The right-hand facts are claims about the user's document, so they are measured rather than
/// assumed - `LF` in particular is detected from the text, and says `Mixed` when a file genuinely is.
/// The markdown flavour is one of them: detected from what the document contains, and a chip
/// because it is the one fact here the reader may overrule.
export default function EditorStatusBar({
  mode,
  fileTypeKey,
  lineEnding,
  stats,
  flavour,
  onFlavourChange,
}: Props) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const choosing = flavour !== undefined && onFlavourChange !== undefined;

  return (
    <div className="flex items-center gap-3 border-t border-rule bg-panel px-3 py-1 text-xs text-ink-4">
      <span className="min-w-0 truncate">{t(MODE_HINT_KEYS[mode])}</span>
      <span className="ml-auto shrink-0 tabular-nums">{stats}</span>
      <span className="shrink-0">{t(fileTypeKey)}</span>
      {choosing && <FlavourChip flavour={flavour} onOpen={(x, y) => setMenu({ x, y })} />}
      {choosing && menu !== null && (
        <ContextMenu
          label={t("editor.flavour.label")}
          x={menu.x}
          y={menu.y}
          above
          onDismiss={() => setMenu(null)}
        >
          {CHOICES.map((choice) => (
            <ContextMenuItem
              key={choice}
              checked={flavour.choice === choice}
              onClick={() => {
                setMenu(null);
                onFlavourChange(choice);
              }}
            >
              {choice === "auto"
                ? t("editor.flavour.auto", { flavour: flavourName(flavour.detected.flavour, t) })
                : flavourName(choice, t)}
            </ContextMenuItem>
          ))}
        </ContextMenu>
      )}
      <span className="shrink-0">{t("editor.encoding")}</span>
      <span className="shrink-0 tabular-nums">{lineEnding}</span>
    </div>
  );
}

type Translate = ReturnType<typeof useTranslation>["t"];

/// Written out rather than built from the flavour, so the catalogue guard can see every key.
function flavourName(flavour: "gfm" | "obsidian", t: Translate): string {
  return flavour === "obsidian" ? t("editor.flavour.nameObsidian") : t("editor.flavour.nameGfm");
}

function flavourFullName(flavour: "gfm" | "obsidian", t: Translate): string {
  return flavour === "obsidian" ? t("editor.flavour.fullObsidian") : t("editor.flavour.fullGfm");
}

function FlavourChip({
  flavour,
  onOpen,
}: {
  flavour: { detected: DetectedFlavour; choice: FlavourChoice };
  onOpen: (x: number, y: number) => void;
}) {
  const { t } = useTranslation();
  const effective = effectiveFlavour(flavour.detected, flavour.choice);
  const name = flavourName(effective, t);
  const full = flavourFullName(effective, t);

  // What decided it, in the reader's words: their own choice, the vault, or the marks found.
  const found = FLAVOUR_SIGNALS.flatMap((signal) => {
    const count = flavour.detected.signals[signal];
    if (count === undefined) return [];
    return [
      count === 1 ? t(`editor.flavour.signal.${signal}`) : t(`editor.flavour.signals.${signal}`, { count }),
    ];
  });
  const why =
    flavour.choice !== "auto"
      ? t("editor.flavour.chosen", { flavour: full })
      : flavour.detected.vault
        ? t("editor.flavour.fromVault", { flavour: full })
        : found.length > 0
          ? t("editor.flavour.fromSignals", { flavour: full, signals: found.join(", ") })
          : t("editor.flavour.detected", { flavour: full });

  return (
    <button
      type="button"
      aria-label={t("editor.flavour.chip", { flavour: name })}
      title={why}
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        onOpen(box.right, box.top - 4);
      }}
      className={
        effective === "obsidian"
          ? "shrink-0 rounded-full border border-accent px-2 text-accent hover:bg-hover"
          : "shrink-0 rounded-full border border-rule px-2 text-ink-3 hover:bg-hover"
      }
    >
      {name}
    </button>
  );
}
