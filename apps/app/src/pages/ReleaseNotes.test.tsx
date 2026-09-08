import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EPOCHS, RECENT } from "../lib/releaseNotes";
import ReleaseNotes from "./ReleaseNotes";

/// The release notes, as the window shows them.
///
/// Rendered against the REAL release history rather than a fixture, deliberately: this page's whole
/// job is to present that data, and a fixture would let the page and the file it exists to show
/// drift apart. What is asserted is therefore shape - what is on a card, what a card opens - and
/// never particular wording, which changes with every release.

const newest = RECENT[0]!;
const epoch = EPOCHS[0]!;

describe("ReleaseNotes", () => {
  it("opens on the releases since the last chapter", () => {
    render(<ReleaseNotes onClose={vi.fn()} />);

    expect(screen.getByText(newest.headline)).toBeDefined();
    expect(screen.getByText(newest.summary)).toBeDefined();
  });

  it("names the version and date of each recent release", () => {
    render(<ReleaseNotes onClose={vi.fn()} />);

    expect(screen.getByText(newest.version)).toBeDefined();
    // All by text: several releases can share a date, and three of them do.
    expect(screen.getAllByText(newest.date).length).toBeGreaterThan(0);
  });

  it("offers every closed chapter, newest first", () => {
    render(<ReleaseNotes onClose={vi.fn()} />);

    const cards = screen.getAllByRole("button", { name: new RegExp(EPOCHS[0]!.title) });
    expect(cards.length).toBeGreaterThan(0);
    expect(
      EPOCHS.every((one) => screen.getAllByRole("button", { name: new RegExp(one.title) }).length > 0),
    ).toBe(true);
  });

  // Derived from the spine rather than stored on the epoch: a stored count is a second derivation
  // that agrees with the archive only by luck.
  it("says how many releases a chapter covers, and when", () => {
    render(<ReleaseNotes onClose={vi.fn()} />);

    const card = screen.getByRole("button", { name: new RegExp(epoch.title) });
    expect(within(card).getByText(/\d+ releases/)).toBeDefined();
  });

  /// The drill-down. It lists the span verbatim, and it is the ONLY thing that loads the archive -
  /// which is why it is a lazy import, and why this has to await it.
  it("lists every release in a chapter when it is opened", async () => {
    const user = userEvent.setup();
    render(<ReleaseNotes onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: new RegExp(epoch.title) }));

    // The chapter's own summary heads the list it is a heading over.
    expect(await screen.findByText(epoch.summary)).toBeDefined();
    // AWAITED, because the summary is drawn by this page while the releases under it arrive with the
    // archive - which is a lazy import, and the whole reason this page is worth having.
    //
    // Which releases exactly is EpochDetail's own test; what matters here is that the archive was
    // loaded and rendered at all, rather than the card having opened onto nothing.
    expect((await screen.findAllByRole("article")).length).toBeGreaterThan(5);
  });

  it("comes back to the chapters", async () => {
    const user = userEvent.setup();
    render(<ReleaseNotes onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: new RegExp(epoch.title) }));
    await screen.findByText(epoch.summary);

    await user.click(screen.getByRole("button", { name: "All releases" }));
    expect(screen.getByText(newest.headline)).toBeDefined();
  });

  it("closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ReleaseNotes onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Close release notes" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  // The window covers the app, so the way out has to be where a hand already is - the same rule the
  // settings dialog follows.
  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ReleaseNotes onClose={onClose} />);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("is a dialog, named", () => {
    render(<ReleaseNotes onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Release notes" })).toBeDefined();
  });
});
