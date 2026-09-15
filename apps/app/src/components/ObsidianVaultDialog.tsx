import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ObsidianVaultEntry, ObsidianVaultsResult } from "../lib/workspaceClient";

interface Props {
  /// Obsidian's list of vaults, asked for when the dialog opens - see `ObsidianVaultsResult`.
  loadVaults: () => Promise<ObsidianVaultsResult>;
  /// The vault the user chose, by Obsidian's id for it. Opening it is the workspace's business.
  onOpen: (id: string) => void;
  onCancel: () => void;
}

type Listing = { status: "loading" } | { status: "failed" } | { status: "loaded"; vaults: ObsidianVaultEntry[] };

/// Choosing one of Obsidian's vaults to open.
///
/// **Read when the dialog opens**, not when the app starts: Obsidian can add, move and remove vaults
/// while this app is running, and the list is one small file.
///
/// Laid out as the repository picker is - one click on a row opens it - because the two are the same
/// act from the user's side, and one that needed a second press to confirm would be the odd one out.
export default function ObsidianVaultDialog({ loadVaults, onOpen, onCancel }: Props) {
  const { t } = useTranslation();
  const [listing, setListing] = useState<Listing>({ status: "loading" });
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let current = true;
    void loadVaults().then((result) => {
      if (!current) return;
      setListing(result.ok ? { status: "loaded", vaults: result.vaults } : { status: "failed" });
    });
    return () => {
      current = false;
    };
  }, [loadVaults]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // The first vault that can be opened takes the focus, so Enter opens it and the arrows are not
  // needed to get into the list at all.
  useEffect(() => {
    if (listing.status === "loaded") first.current?.focus();
  }, [listing]);

  const firstAvailable = listing.status === "loaded" ? listing.vaults.find((vault) => vault.available) : undefined;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("obsidian.title")}
      // Flex rather than grid, for the reason written on `OpenRepoDialog`: a grid row sizes to the
      // unclipped content and draws a tall panel off the bottom of a short window.
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="flex max-h-[min(32rem,100%)] w-full max-w-[30rem] flex-col rounded-lg border border-rule bg-app p-4 shadow-menu">
        <h2 className="text-sm font-semibold text-ink">{t("obsidian.title")}</h2>
        <p className="mt-1 text-xs text-ink-3">{t("obsidian.blurb")}</p>

        <div className="mt-3 min-h-0 grow overflow-auto">
          {listing.status === "loading" && <p className="p-2 text-sm text-ink-3">{t("obsidian.loading")}</p>}

          {listing.status === "failed" && (
            <p role="alert" className="rounded border border-rule bg-panel p-2 text-xs text-ink-2">
              {t("obsidian.loadFailed")}
            </p>
          )}

          {listing.status === "loaded" && listing.vaults.length === 0 && (
            <p className="p-2 text-sm text-ink-3">{t("obsidian.noVaults")}</p>
          )}

          {listing.status === "loaded" &&
            listing.vaults.map((vault) => (
              <button
                key={vault.id}
                ref={vault === firstAvailable ? first : undefined}
                type="button"
                // `aria-disabled` rather than `disabled`, so the row stays readable and focusable and
                // says why it cannot be opened, rather than silently skipping out of the tab order.
                aria-disabled={vault.available ? undefined : "true"}
                onClick={() => {
                  if (vault.available) onOpen(vault.id);
                }}
                title={vault.path}
                className={
                  vault.available
                    ? "flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left hover:bg-hover"
                    : "flex w-full cursor-default flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left opacity-60"
                }
              >
                <span className="flex w-full items-center gap-2">
                  <span className="truncate text-ui font-medium text-ink">{vault.name}</span>
                  {!vault.available && (
                    <span className="shrink-0 rounded border border-rule px-1 text-[0.65rem] text-ink-4">
                      {t("obsidian.missing")}
                    </span>
                  )}
                </span>
                <span className="w-full truncate text-xs text-ink-3">{vault.path}</span>
              </button>
            ))}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-rule px-3 py-1 text-ui text-ink hover:bg-hover"
          >
            {t("obsidian.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
