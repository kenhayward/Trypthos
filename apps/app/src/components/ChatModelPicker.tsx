import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { ChatProfile } from "@trypthos/domain";

/// Menu width in px. Wider than the chat panel on purpose: the menu is portalled and fixed, so it
/// overhangs onto the editor behind it, which is what gives the name and the model slug room to sit
/// on one line.
const WIDTH = 340;
/// Gap between the button and the menu.
const GAP = 4;
/// Keeps the menu off the very edge of the viewport when it has to be nudged back inside.
const MARGIN = 8;

interface Props {
  models: readonly ChatProfile[];
  selectedId: string | null;
  /// True while a reply is streaming: switching then would change the model behind an answer already
  /// arriving, and the turn is in flight with the old one either way.
  disabled?: boolean;
  onSelect: (id: string) => void;
}

/// Chooses which model answers the next turn.
///
/// Ported from Diariz, where the options came from a server query; here they are the local profile
/// list. Everything else is unchanged, including the reason rows carry the LABEL and show the slug
/// only as secondary text: the slug is what the endpoint needs, not what somebody choosing a model
/// should have to read.
export default function ChatModelPicker({ models, selectedId, disabled = false, onSelect }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Right-aligned on the button, nudged back inside the viewport rather than allowed to hang off it.
  const place = useCallback(() => {
    const anchor = buttonRef.current?.getBoundingClientRect();
    if (!anchor) return;
    setPos({
      top: anchor.bottom + GAP,
      left: Math.max(MARGIN, Math.min(anchor.right - WIDTH, window.innerWidth - WIDTH - MARGIN)),
    });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;

    function onDocument(event: MouseEvent) {
      // The menu is not a descendant of the button, so it needs its own containment check - without
      // it a row's mousedown would close the menu and unmount the row before its click landed.
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onDocument);
    document.addEventListener("keydown", onKey);
    // A fixed menu does not travel with its anchor: resizing the window moves the right-docked panel,
    // and any scroll under it shifts the button. Re-place rather than let the menu drift off it.
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDocument);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  // A model can be removed from Preferences between one turn and the next, so a remembered id may
  // name a model that is no longer configured. Falling back to the default is the same rule the
  // shell applies when it resolves the profile, which keeps the two in agreement.
  const selected =
    models.find((model) => model.id === selectedId) ??
    models.find((model) => model.isDefault) ??
    models[0] ??
    null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled || models.length === 0}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        title={t("chat.chooseModel")}
        aria-label={t("chat.chooseModel")}
        className="flex max-w-40 items-center gap-1 rounded px-1.5 py-1 text-xs text-ink-4 hover:bg-hover hover:text-ink disabled:opacity-50"
      >
        <span className="truncate">{selected?.label ?? t("chat.noModel")}</span>
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-3 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open &&
        pos !== null &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={t("chat.chooseModel")}
            style={{ top: pos.top, left: pos.left, width: WIDTH }}
            className="fixed z-50 overflow-hidden rounded-md border border-rule bg-app py-1 shadow-menu"
          >
            {models.map((model) => (
              <button
                key={model.id}
                type="button"
                role="menuitemradio"
                aria-checked={model.id === selected?.id}
                onClick={() => {
                  onSelect(model.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover"
              >
                <span className="text-ui text-ink">{model.label}</span>
                <span className="truncate text-xs text-ink-4">{model.model}</span>
                {model.id === selected?.id && (
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    className="ml-auto size-3.5 shrink-0 text-leaf"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 12l5 5L20 6" />
                  </svg>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
