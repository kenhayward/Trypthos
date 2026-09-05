import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FILE_TYPES } from "@trypthos/domain";
import SettingsFileTypes from "./SettingsFileTypes";

function page(enabled: readonly string[] = ["markdown"]) {
  const onChange = vi.fn();
  render(<SettingsFileTypes enabled={enabled} onChange={onChange} />);
  return { onChange };
}

const box = (name: string) => screen.getByRole("checkbox", { name: new RegExp(name) });

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
});
