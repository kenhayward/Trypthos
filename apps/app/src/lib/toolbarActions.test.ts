import { describe, expect, it } from "vitest";
import { TOOLBAR_ACTIONS } from "@trypthos/domain";
import { ACTION_LABEL_KEYS, TOOLBAR_GROUPS } from "./toolbarActions";
import en from "../locales/en.json";

/// Two lists that have to agree with a third: the actions the domain defines, the groups the
/// toolbar draws, and the catalogue the labels come from.
///
/// None of the three fails loudly on its own. An action with no group is a button that is simply
/// not there, an action in two groups is a button that appears twice, and a label key with no entry
/// renders as `editor.toolbar.bold` under the cursor. All three survive a screenshot.

const grouped = TOOLBAR_GROUPS.flat();

describe("the toolbar's buttons", () => {
  it("draws every action exactly once", () => {
    expect([...grouped].sort()).toEqual([...TOOLBAR_ACTIONS].sort());
  });

  it("names every action", () => {
    expect(Object.keys(ACTION_LABEL_KEYS).sort()).toEqual([...TOOLBAR_ACTIONS].sort());
  });

  it("names them from keys the catalogue answers", () => {
    const labels = (en as { editor: { toolbar: Record<string, string> } }).editor.toolbar;
    const missing = Object.values(ACTION_LABEL_KEYS).filter(
      (key) => labels[key.replace("editor.toolbar.", "")] === undefined,
    );

    expect(missing).toEqual([]);
  });
});
