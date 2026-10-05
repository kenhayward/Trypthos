import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspaceRef } from "@trypthos/domain";
import GoogleAccountSection from "./GoogleAccountSection";
import { attempt } from "../hooks/useGitHub";
import { providerFailureKey } from "../hooks/useWorkspace";
import type { DriveFoldersResult, GoogleBridge } from "../lib/workspaceClient";

interface Props {
  /// The Google half of the shell, or null in the browser preview.
  bridge: GoogleBridge | null;
  onCancel: () => void;
  /// The folder the user chose. Opening it is the workspace's business, not this dialog's.
  onOpen: (ref: WorkspaceRef) => void;
}

/// One step of the breadcrumb: a folder the user went into, and the Shared Drive it is in.
interface Place {
  id: string;
  name: string;
  driveId: string | null;
}

/// What a request came back with. "Loading" is not stored: it is whatever is left when the answer on
/// hand was for a different request than the one now wanted, which spares the effect a synchronous
/// `setState` on every step.
type Listing =
  | { state: "connect" }
  | { state: "failed"; errorKey: string }
  | { state: "loaded"; folders: { id: string; name: string }[]; drives: { id: string; name: string }[] };

/// Choosing a Google Drive folder to open as a workspace.
///
/// Browses folders only, through `google:folders`, from the top level (My Drive's folders, then the
/// Shared Drives) down. "Open this folder" is offered inside any folder - the top level is not a
/// folder, and a whole-My-Drive workspace is deferred. With no account connected, it shows the same
/// connect control as Settings, and carries on once one is.
export default function OpenDriveDialog({ bridge, onCancel, onOpen }: Props) {
  const { t } = useTranslation();
  const [trail, setTrail] = useState<Place[]>([]);
  const [answer, setAnswer] = useState<{ request: string; listing: Listing } | null>(null);
  const [reloads, setReloads] = useState(0);
  const here = trail.at(-1) ?? null;
  const request = `${here?.id ?? ""}#${reloads}`;
  const listing: Listing | { state: "loading" } = answer !== null && answer.request === request ? answer.listing : { state: "loading" };

  useEffect(() => {
    if (bridge === null) return;
    let live = true;
    void (async () => {
      const result: DriveFoldersResult = await attempt(() => bridge.listDriveFolders(here?.id ?? null));
      if (!live) return;
      if (result.ok) {
        setAnswer({ request, listing: { state: "loaded", folders: result.folders, drives: result.drives } });
      } else if (result.reason === "not-connected" || result.reason === "not-configured") {
        setAnswer({ request, listing: { state: "connect" } });
      } else {
        const errorKey = providerFailureKey("google-drive", result.reason) ?? "errors.unknown";
        setAnswer({ request, listing: { state: "failed", errorKey } });
      }
    })();
    return () => {
      live = false;
    };
  }, [bridge, here, request]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const enter = useCallback((place: Place) => setTrail((previous) => [...previous, place]), []);

  const open = () => {
    if (here === null) return;
    onOpen({
      kind: "google-drive",
      folderId: here.id,
      ...(here.driveId === null ? {} : { driveId: here.driveId }),
      name: here.name,
    });
  };

  const rowClass = "w-full truncate px-2 py-1 text-left text-ui text-ink hover:bg-hover";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("drive.title")}
      // Flex, not a grid, for the reason `OpenRepoDialog` gives: a grid row is sized to the unclipped
      // panel and draws a tall one off the bottom of the window.
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="flex max-h-[min(32rem,100%)] w-full max-w-[30rem] flex-col rounded-lg border border-rule bg-app p-4 shadow-menu">
        <h2 className="text-sm font-semibold text-ink">{t("drive.title")}</h2>

        {bridge === null || listing.state === "connect" ? (
          <GoogleAccountSection bridge={bridge} onConnected={() => setReloads((count) => count + 1)} />
        ) : (
          <>
            <nav className="mt-3 flex flex-wrap items-center gap-1 text-xs text-ink-3">
              <button type="button" className="rounded px-1 hover:bg-hover" onClick={() => setTrail([])}>
                {t("drive.root")}
              </button>
              {trail.map((place, index) => (
                <span key={place.id} className="flex items-center gap-1">
                  <span aria-hidden="true">/</span>
                  <button
                    type="button"
                    className="rounded px-1 hover:bg-hover"
                    onClick={() => setTrail((previous) => previous.slice(0, index + 1))}
                  >
                    {place.name}
                  </button>
                </span>
              ))}
            </nav>

            <div className="mt-2 min-h-32 flex-1 overflow-y-auto rounded border border-rule">
              {listing.state === "loading" && <p className="p-2 text-xs text-ink-3">{t("drive.loading")}</p>}
              {listing.state === "failed" && (
                <p role="alert" className="m-2 rounded border border-rule bg-panel p-2 text-xs text-ink-2">
                  {t(listing.errorKey)}
                </p>
              )}
              {listing.state === "loaded" && (
                <>
                  {here === null && listing.folders.length > 0 && (
                    <h3 className="px-2 pt-2 text-xs font-medium text-ink-4">{t("drive.myDrive")}</h3>
                  )}
                  <ul>
                    {listing.folders.map((folder) => (
                      <li key={folder.id}>
                        <button
                          type="button"
                          className={rowClass}
                          onClick={() => enter({ id: folder.id, name: folder.name, driveId: here?.driveId ?? null })}
                        >
                          {folder.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {listing.drives.length > 0 && (
                    <>
                      <h3 className="px-2 pt-2 text-xs font-medium text-ink-4">{t("drive.sharedDrives")}</h3>
                      <ul>
                        {listing.drives.map((drive) => (
                          <li key={drive.id}>
                            <button
                              type="button"
                              className={rowClass}
                              onClick={() => enter({ id: drive.id, name: drive.name, driveId: drive.id })}
                            >
                              {drive.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {listing.folders.length === 0 && listing.drives.length === 0 && (
                    <p className="p-2 text-xs text-ink-3">{t("drive.empty")}</p>
                  )}
                </>
              )}
            </div>

            <p className="mt-2 text-xs text-ink-4">{t("drive.readOnlyNote")}</p>
          </>
        )}

        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded border border-rule px-3 py-1 text-ui text-ink hover:bg-hover">
            {t("drive.cancel")}
          </button>
          {here !== null && listing.state !== "connect" && (
            <button type="button" onClick={open} className="rounded bg-accent px-3 py-1 text-ui text-on-accent">
              {t("drive.openThis")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
