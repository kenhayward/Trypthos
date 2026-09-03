import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MENU_NAMES, titleBarLayout, windowTitle, type Platform } from "@trypthos/domain";
import { APP_NAME, APP_VERSION } from "../lib/appInfo";
import { windowControls } from "../lib/windowControls";

interface Props {
  platform: Platform;
  fileName: string | null;
  onAbout: () => void;
  onPreferences: () => void;
}

/// The window's own title bar.
///
/// The window is frameless, so this is the only title bar there is - and it replaces the in-app
/// header rather than sitting above it, because two bars in an Electron window is one too many.
///
/// Whether it draws window controls comes from the shared layout function the SHELL also calls. If
/// the two disagreed the window would have either two sets of controls or none, and none is
/// unrecoverable: a frameless window with no close button cannot be closed from inside the app.
export default function TitleBar({ platform, fileName, onAbout, onPreferences }: Props) {
  const { t } = useTranslation();
  const layout = titleBarLayout(platform);
  const [maximized, setMaximized] = useState(false);

  // Pushed from the shell rather than asked for, because the window can be maximised by ways this
  // component never sees: a double-click on the bar, an OS snap gesture, a keyboard shortcut.
  useEffect(() => windowControls().onWindowState((state) => setMaximized(state.maximized)), []);

  return (
    <header
      // The whole bar drags the window, and every control inside it opts back out. Without this a
      // frameless window cannot be moved at all; without the opt-outs, its buttons cannot be clicked.
      // The inset is inline because it is a computed value; the drag regions are classes because
      // jsdom drops the property and an inline assertion could not tell whether it was applied.
      style={{ paddingLeft: layout.leadingInset }}
      className="app-drag flex h-8 shrink-0 items-center gap-2 border-b border-hairline bg-app pr-0 pl-3 select-none"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-3.5 shrink-0 text-leaf"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </svg>

      {layout.drawsMenuBar && (
        // Real native menus, opened under these labels. The window is frameless, so there is no
        // frame for Electron to draw a menu bar in - but `Menu.popup()` still gives native
        // rendering, native accelerator text and the native edit roles.
        //
        // Nothing here knows what is on a menu: the main process decides that, so a page cannot
        // invent an item or a click handler.
        <nav aria-label={t("menu.bar")} className="app-no-drag flex items-center">
          {MENU_NAMES.map((menu) => (
            <button
              key={menu}
              type="button"
              onClick={(event) => {
                // Measured from the label, not from the pointer: a menu bar's menus hang off the
                // label whether it was clicked at its left edge or its right.
                const at = event.currentTarget.getBoundingClientRect();
                void windowControls().popupMenu(menu, Math.round(at.left), Math.round(at.bottom));
              }}
              className="rounded px-2 py-0.5 text-sm text-ink-3 hover:bg-hover hover:text-ink"
            >
              {t(`menu.${menu}`)}
            </button>
          ))}
        </nav>
      )}

      <span className="min-w-0 truncate text-sm text-ink-3">{windowTitle(APP_NAME, fileName)}</span>

      <div className="app-no-drag ml-auto flex items-center">
        <button
          type="button"
          onClick={onPreferences}
          aria-label={t("preferences.open")}
          title={t("preferences.open")}
          className="rounded p-1 text-ink-5 hover:bg-hover hover:text-ink"
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
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        <button
          type="button"
          onClick={onAbout}
          className="mr-1 rounded px-2 py-1 text-xs text-ink-5 hover:bg-hover hover:text-ink"
        >
          {t("app.about", { version: APP_VERSION })}
        </button>

        {layout.drawsWindowControls && (
          <>
            <WindowButton label={t("window.minimize")} onClick={() => void windowControls().minimizeWindow()}>
              <path d="M5 12h14" />
            </WindowButton>

            <WindowButton
              label={maximized ? t("window.restore") : t("window.maximize")}
              onClick={() => void windowControls().toggleMaximizeWindow()}
            >
              {maximized ? (
                <>
                  <rect x="8" y="5" width="11" height="11" rx="1" />
                  <path d="M16 19H6a1 1 0 0 1-1-1V8" />
                </>
              ) : (
                <rect x="5" y="5" width="14" height="14" rx="1" />
              )}
            </WindowButton>

            <WindowButton
              label={t("window.close")}
              danger
              onClick={() => void windowControls().closeWindow()}
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </WindowButton>
          </>
        )}
      </div>
    </header>
  );
}

interface ButtonProps {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

/// 46px wide, per the design. Close is the only one that turns red, and it turns its glyph white with
/// it - a red button with a dark glyph on it reads as disabled.
function WindowButton({ label, danger = false, onClick, children }: ButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={
        danger
          ? "flex h-8 w-[46px] items-center justify-center text-ink-4 hover:bg-danger-strong hover:text-white"
          : "flex h-8 w-[46px] items-center justify-center text-ink-4 hover:bg-hover hover:text-ink"
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
        {children}
      </svg>
    </button>
  );
}
