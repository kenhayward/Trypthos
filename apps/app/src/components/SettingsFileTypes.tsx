import { useTranslation } from "react-i18next";
import { FILE_TYPES, FILE_TYPE_GROUPS, type FileTypeId } from "@trypthos/domain";

interface Props {
  /// The types that are on, by id, straight from settings. An id this build does not recognise is
  /// passed through untouched: it belongs to a newer version and is not this page's to discard.
  enabled: readonly string[];
  onChange: (enabled: string[]) => void;
}

/// Settings: which file types Trypthos takes an interest in.
///
/// The page is about SCOPE, not about performance, and the wording says so. A language's colouring
/// is loaded only when a file needs it, so a box here buys back nothing at startup - what it decides
/// is what the folder tree lists, what the editor will open, and what chat can see. Turning one on
/// in a source repository is several hundred more rows in the left panel, which is the trade the
/// user is actually making.
///
/// Rows come from the domain catalogue rather than being written out here, so the page, the tree and
/// the settings schema cannot disagree about which types exist.
export default function SettingsFileTypes({ enabled, onChange }: Props) {
  const { t } = useTranslation();

  const toggle = (id: FileTypeId, on: boolean) => {
    // Rebuilt from the catalogue order rather than appended to, so the stored list reads the same
    // way the page does - and an id from a newer build is carried across untouched rather than
    // being dropped by a rewrite it had nothing to do with.
    const known = new Set(FILE_TYPES.map((type) => type.id) as string[]);
    const unknown = enabled.filter((stored) => !known.has(stored));
    const chosen = FILE_TYPES.filter((type) =>
      type.id === id ? on : type.pinned || enabled.includes(type.id),
    ).map((type) => type.id);

    onChange([...chosen, ...unknown]);
  };

  return (
    <div className="max-w-2xl">
      <p className="mb-4 text-xs text-ink-4">{t("settings.fileTypes.intro")}</p>

      {FILE_TYPE_GROUPS.map((group) => (
        <section key={group} className="mb-5">
          <h3 className="mb-2 text-xs font-medium text-ink-4">
            {t(`settings.fileTypes.group.${group}`)}
          </h3>

          <div className="flex flex-col gap-2">
            {FILE_TYPES.filter((type) => type.group === group).map((type) => (
              <label key={type.id} className="flex items-start gap-2 text-base text-ink">
                <input
                  type="checkbox"
                  // A pinned type is drawn checked and disabled rather than left out. Markdown is
                  // what the app is, and a page that simply did not mention it would read as though
                  // it could be turned off somewhere else.
                  checked={type.pinned || enabled.includes(type.id)}
                  disabled={type.pinned}
                  onChange={(event) => toggle(type.id, event.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  {t(type.labelKey)}
                  {type.pinned && (
                    <span className="ml-2 text-xs text-ink-4">{t("settings.fileTypes.always")}</span>
                  )}
                  {/* The extensions are data, not wording: read from the catalogue so a type that
                      gains one in a later release says so without anybody editing a string. */}
                  <span className="mt-0.5 block font-mono text-xs text-ink-4">
                    {[...type.extensions.map((extension) => `.${extension}`), ...type.filenames].join(
                      "  ",
                    )}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
