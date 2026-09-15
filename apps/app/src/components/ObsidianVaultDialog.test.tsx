import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ObsidianVaultDialog from "./ObsidianVaultDialog";
import type { ObsidianVaultsResult } from "../lib/workspaceClient";

const VAULTS: ObsidianVaultsResult = {
  ok: true,
  installed: true,
  vaults: [
    { id: "cccc3333dddd4444", name: "Archive", path: "D:/Vaults/Archive", available: false },
    { id: "aaaa1111bbbb2222", name: "Garden", path: "D:/Vaults/Garden", available: true },
  ],
};

function draw(answer: ObsidianVaultsResult = VAULTS) {
  const props = {
    loadVaults: vi.fn(async () => answer),
    onOpen: vi.fn(),
    onCancel: vi.fn(),
  };
  render(<ObsidianVaultDialog {...props} />);
  return props;
}

describe("ObsidianVaultDialog", () => {
  it("lists each vault Obsidian knows by name, with its folder", async () => {
    draw();

    const garden = await screen.findByRole("button", { name: /Garden/ });
    expect(garden.textContent).toContain("D:/Vaults/Garden");
    expect(screen.getByRole("dialog", { name: "Open Obsidian vault" })).toBeDefined();
  });

  it("opens the vault that is chosen, by its id", async () => {
    const props = draw();

    await userEvent.setup().click(await screen.findByRole("button", { name: /Garden/ }));

    expect(props.onOpen).toHaveBeenCalledWith("aaaa1111bbbb2222");
  });

  // Obsidian remembers a vault whose folder has since been moved or deleted. Listed, so the user can
  // see why it is not there, but not something that can be chosen.
  it("says a vault whose folder has gone cannot be opened, and does not open it", async () => {
    const props = draw();

    const archive = await screen.findByRole("button", { name: /Archive/ });
    expect(archive.getAttribute("aria-disabled")).toBe("true");
    expect(archive.textContent).toContain("Folder not found");

    await userEvent.setup().click(archive);
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it("cancels from the button and from Escape", async () => {
    const props = draw();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: /Garden/ });

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.keyboard("{Escape}");

    expect(props.onCancel).toHaveBeenCalledTimes(2);
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it("says when Obsidian has no vaults", async () => {
    draw({ ok: true, installed: true, vaults: [] });
    expect(await screen.findByText("Obsidian has no vaults on this computer.")).toBeDefined();
  });

  it("says when the list could not be read", async () => {
    draw({ ok: false, reason: "not-desktop" });
    expect(await screen.findByRole("alert")).toBeDefined();
  });

  it("says it is reading until the list arrives", async () => {
    let answer: (value: ObsidianVaultsResult) => void = () => {};
    render(
      <ObsidianVaultDialog
        loadVaults={() => new Promise((resolve) => (answer = resolve))}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Reading Obsidian's vaults")).toBeDefined();
    answer(VAULTS);
    await waitFor(() => expect(screen.queryByText("Reading Obsidian's vaults")).toBeNull());
  });
});
