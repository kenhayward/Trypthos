import { useTranslation } from "react-i18next";
import { FILE_TYPES, FILE_TYPE_GROUPS, type FileTypeId } from "@trypthos/domain";

interface Props {
  /// The types that are on, by id, straight from settings. An id this build does not recognise is
  /// passed through untouched: it belongs to a newer version and is not this page's to discard.
  enabled: readonly string[];
  onChange: (enabled: string[]) => void;
}

/// Columns, fixed and shared by every group's table.
///
/// `table-fixed` is what makes the five tables read as one list. Without declared widths each table
/// sizes its columns to its own longest label, so the extension column starts somewhere new in every
/// group and there is no line for the eye to run down.
const CHECK_COLUMN = "w-[30px]";
const NAME_COLUMN = "w-[190px]";

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
///
/// One row per type, in a table per group. The row is the target, not the box: a page of thirty-odd
/// thirteen-pixel checkboxes is a page of aiming, and the row is the width the dialog already has.
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
    <div>
      <p className="mb-4 text-xs text-ink-4">{t("settings.fileTypes.intro")}</p>

      {FILE_TYPE_GROUPS.map((group) => {
        const types = FILE_TYPES.filter((type) => type.group === group);
        const headingId = `file-types-${group}`;

        return (
          <section key={group} className="mb-5">
            <h3 id={headingId} className="mb-1.5 text-xs font-medium text-ink-4">
              {t(`settings.fileTypes.group.${group}`)}
            </h3>

            {/* Named by the heading above it rather than by a label of its own, so a screen reader
                hears each group's name once. There is no header row: a column of boxes, a column of
                names, and what each one matches beside them is not a shape that needs labelling. */}
            <table aria-labelledby={headingId} className="w-full table-fixed border-collapse">
              <tbody>
                {types.map((type) => {
                  const on = type.pinned || enabled.includes(type.id);
                  const inputId = `file-type-${type.id}`;
                  // A pinned row is drawn, not live: a row that highlights and does nothing is worse
                  // than one that says in words that it cannot be turned off.
                  const clickable = !type.pinned;

                  return (
                    <tr
                      key={type.id}
                      className={
                        clickable
                          ? "cursor-pointer border-b border-hairline align-top hover:bg-hover"
                          : "border-b border-hairline align-top"
                      }
                      onClick={
                        clickable
                          ? (event) => {
                              // The box, and the name that is its label, toggle through their own
                              // handlers. Without this guard a click on either lands here too, and
                              // writes twice.
                              if (event.target instanceof Element && event.target.closest("label, input")) {
                                return;
                              }
                              toggle(type.id, !on);
                            }
                          : undefined
                      }
                    >
                      <td className={`${CHECK_COLUMN} py-1.5 pr-1 pl-1`}>
                        <input
                          id={inputId}
                          type="checkbox"
                          // A pinned type is drawn checked and disabled rather than left out.
                          // Markdown is what the app is, and a page that simply did not mention it
                          // would read as though it could be turned off somewhere else.
                          checked={on}
                          disabled={type.pinned}
                          onChange={(event) => toggle(type.id, event.target.checked)}
                        />
                      </td>

                      {/* The label points at the box by id rather than wrapping it. The name is the
                          widest thing in the row, so it is what the row is clicked through, and
                          `htmlFor` keeps it the box's accessible name from inside that cell. The
                          "always on" note sits beside the label, not inside it: the box is called
                          "Markdown", not "Markdown always on". */}
                      <td className={`${NAME_COLUMN} py-1.5 pr-2`}>
                        <label htmlFor={inputId} className="text-base text-ink">
                          {t(type.labelKey)}
                        </label>
                        {type.pinned && (
                          <span className="ml-2 text-2xs text-ink-4">
                            {t("settings.fileTypes.always")}
                          </span>
                        )}
                      </td>

                      {/* The extensions are data, not wording: read from the catalogue, so a type that
                          gains one in a later release says so without anybody editing a string. This
                          cell takes the width left over, which is the whole reason for the table -
                          stacked under the name, thirty-odd of these is two screens of scrolling. */}
                      <td className="py-1.5 font-mono text-xs leading-5 text-ink-4">
                        {[
                          ...type.extensions.map((extension) => `.${extension}`),
                          ...type.filenames,
                        ].join("  ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
