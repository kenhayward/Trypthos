import { useTranslation } from "react-i18next";
import type { ChatProfile } from "@trypthos/domain";
import {
  SECTION_LABEL_KEYS,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from "../lib/settingsSections";

interface Props {
  current: SettingsSection;
  /// Window is desktop-only: the browser preview has no tray to close to, so the page would be one
  /// control that cannot do anything.
  isDesktop: boolean;
  /// Listed under Chat models while that page is open, as a way around the one page.
  models: readonly ChatProfile[];
  onSection: (section: SettingsSection) => void;
  onEditModel: (id: string) => void;
  onAddModel: () => void;
}

/// One path per icon, drawn the same way: feather-style, stroked in the current colour.
///
/// Inline rather than from a library, which is what the rest of the app does - the icon set here is
/// six shapes, and a dependency for six shapes is a dependency to update forever.
const ICONS: Record<SettingsSection, React.ReactNode> = {
  appearance: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>
  ),
  window: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 9h18" />
    </>
  ),
  chatModels: (
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  ),
  ai: (
    <>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </>
  ),
  editor: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  ),
  fileTypes: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <polyline points="14 2 14 8 20 8" />
    </>
  ),
  about: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="8.01" />
    </>
  ),
};

function SectionIcon({ section }: { section: SettingsSection }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONS[section]}
    </svg>
  );
}

/// The settings rail.
///
/// `aria-current` rather than `aria-pressed`: these are not toggles, they are where you are. Once
/// the content pane has swapped, the rail is the only thing that says which page that is.
export default function SettingsNav({
  current,
  isDesktop,
  models,
  onSection,
  onEditModel,
  onAddModel,
}: Props) {
  const { t } = useTranslation();

  const sections = SETTINGS_SECTIONS.filter(
    (section) => section !== "window" || isDesktop,
  );

  return (
    <div className="flex w-[250px] shrink-0 flex-col border-r border-rule bg-panel px-2.5 py-3.5">
      <div className="flex items-center gap-2 px-3 pb-3">
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-[18px] shrink-0 text-leaf"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
        <span className="text-base font-semibold text-ink">{t("settings.title")}</span>
      </div>

      <nav aria-label={t("settings.nav")} className="flex flex-col">
        {sections.map((section) => (
          <div key={section}>
            {/* About is set apart from the working settings above it. */}
            {section === "about" && <div className="mx-2.5 my-2 border-t border-rule" />}

            <button
              type="button"
              aria-current={current === section ? "page" : undefined}
              onClick={() => onSection(section)}
              className={
                current === section
                  ? "flex w-full items-center gap-2.5 rounded-md bg-selected px-3 py-2 text-left text-base font-semibold text-selected-ink"
                  : "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-base text-ink-4 hover:bg-hover hover:text-ink"
              }
            >
              <SectionIcon section={section} />
              <span className="min-w-0 truncate">{t(SECTION_LABEL_KEYS[section])}</span>
            </button>

            {section === "chatModels" && current === "chatModels" && (
              <div className="flex flex-col">
                {models.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    // Named with the label, so a screen reader hears which model is being edited -
                    // a row of buttons all called "Edit" is unusable.
                    aria-label={t("settings.chat.edit", { label: profile.label })}
                    onClick={() => onEditModel(profile.id)}
                    className="flex items-center gap-2 rounded py-1 pr-3 pl-[34px] text-left text-sm text-ink-4 hover:bg-hover hover:text-ink"
                  >
                    <span className="min-w-0 truncate">{profile.label}</span>
                    {profile.isDefault && (
                      <span className="shrink-0 rounded bg-sunken px-1.5 py-0.5 text-2xs text-ink-4">
                        {t("settings.chat.default")}
                      </span>
                    )}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={onAddModel}
                  className="py-1 pr-3 pl-[34px] text-left text-sm text-accent hover:underline"
                >
                  {t("settings.chat.addShort")}
                </button>
              </div>
            )}
          </div>
        ))}
      </nav>
    </div>
  );
}
