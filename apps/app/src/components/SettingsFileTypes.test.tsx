import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FILE_TYPES, FILE_TYPE_GROUPS, type FileTypeGroup } from "@trypthos/domain";
import en from "../locales/en.json";
import SettingsFileTypes from "./SettingsFileTypes";

function page(enabled: readonly string[] = ["markdown"]) {
  const onChange = vi.fn();
  render(<SettingsFileTypes enabled={enabled} onChange={onChange} />);
  return { onChange };
}

const box = (name: string) => screen.getByRole("checkbox", { name: new RegExp(name) });

const groupTable = (group: FileTypeGroup) =>
  screen.getByRole("table", { name: en.settings.fileTypes.group[group] });

/// The row a type is drawn on, found from its own label. `row` is named by its author rather than by
/// its contents, so a name query on the row itself is not a thing to rely on - the label is.
const rowOf = (name: string) => screen.getByText(new RegExp(name)).closest("tr")!;

describe("SettingsFileTypes", () => {
  // Drawn from the catalogue, not written out here, so a type added in a later release appears on
  // this page without anybody remembering to add a row.
  it("draws a row for every type in the catalogue", () => {
    page();
    expect(screen.getAllByRole("checkbox")).toHaveLength(FILE_TYPES.length);
  });

  // Checked AND disabled, rather than absent. A page that simply did not mention markdown would
  // read as though it could be turned off somewhere else.
  it("shows markdown as on and refuses to turn it off", () => {
    page();
    const markdown = box("Markdown") as HTMLInputElement;
    expect(markdown.checked).toBe(true);
    expect(markdown.disabled).toBe(true);
  });

  it("shows what each type matches", () => {
    page();
    expect(screen.getByText(/\.md\s+\.markdown/)).toBeDefined();
  });

  it("turns a type on", async () => {
    const { onChange } = page();
    await userEvent.click(box("Plain text"));
    expect(onChange).toHaveBeenCalledWith(["markdown", "text"]);
  });

  it("turns a type off again", async () => {
    const { onChange } = page(["markdown", "text"]);
    await userEvent.click(box("Plain text"));
    expect(onChange).toHaveBeenCalledWith(["markdown"]);
  });

  // The subtle one. A settings file written by a NEWER build names types this one has never heard
  // of, and this page must not be the thing that deletes them: the user downgrades, unticks
  // something unrelated, upgrades again, and finds their choices quietly gone.
  it("carries an id it does not recognise through a change untouched", async () => {
    const { onChange } = page(["markdown", "klingon"]);
    await userEvent.click(box("Plain text"));
    expect(onChange).toHaveBeenCalledWith(["markdown", "text", "klingon"]);
  });

  // Order comes from the catalogue rather than from the order boxes were ticked, so the stored list
  // reads the same way the page does however the user got there.
  it("stores the types in catalogue order", async () => {
    const { onChange } = page(["text"]);
    await userEvent.click(box("Plain text"));
    expect(onChange).toHaveBeenCalledWith(["markdown"]);
  });

  describe("the table layout", () => {
    // One table per group, each named for its group, so the rail of headings and the tables cannot
    // disagree about which groups exist.
    it("draws one table per group", () => {
      page();
      expect(screen.getAllByRole("table")).toHaveLength(FILE_TYPE_GROUPS.length);
      for (const group of FILE_TYPE_GROUPS) {
        expect(groupTable(group)).toBeDefined();
      }
    });

    // The point of the redesign, stated as a test: a type is ONE row, so its name and everything it
    // matches sit on the same line rather than stacked one under the other.
    it("puts a type's name and its extensions on the same row", () => {
      page();
      const markdown = rowOf("Markdown");
      expect(within(markdown).getByText("Markdown")).toBeDefined();
      expect(within(markdown).getByText(/\.md\s+\.markdown/)).toBeDefined();
    });

    it("rows each group's types in catalogue order", () => {
      page();
      for (const group of FILE_TYPE_GROUPS) {
        // The label the catalogue's own translation key resolves to, so a row that renders a raw key
        // fails here as well as on screen.
        const expected = FILE_TYPES.filter((type) => type.group === group).map(
          (type) => en.fileTypes[type.id],
        );
        const drawn = within(groupTable(group))
          .getAllByRole("row")
          .map((tr) => tr.querySelector("td:nth-child(2) label")?.textContent?.trim() ?? "");
        expect(drawn).toEqual(expected);
      }
    });

    // The reason for the redesign at all: the checkbox is 13px and the row is not.
    it("turns a type on by clicking its row", async () => {
      const { onChange } = page();
      await userEvent.click(rowOf("Plain text").querySelector("td:nth-child(3)")!);
      expect(onChange).toHaveBeenCalledWith(["markdown", "text"]);
    });

    // Clicking the row must not also be a click on the box, or every row click writes twice.
    it("writes once for a click on the box itself", async () => {
      const { onChange } = page();
      await userEvent.click(box("Plain text"));
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("writes once for a click on the type's name", async () => {
      const { onChange } = page();
      await userEvent.click(within(rowOf("Plain text")).getByText("Plain text"));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(["markdown", "text"]);
    });

    // A pinned row is drawn, not clickable: a row that looks live and does nothing is worse than one
    // that plainly says it is always on.
    it("does not toggle a pinned type from its row", async () => {
      const { onChange } = page();
      await userEvent.click(rowOf("Markdown").querySelector("td:nth-child(3)")!);
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
