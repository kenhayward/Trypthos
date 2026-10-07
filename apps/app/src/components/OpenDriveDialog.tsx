import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspaceRef } from "@trypthos/domain";
import DriveGlyph, { type DriveGlyphKind } from "./DriveGlyph";
import CloudAccountSection from "./CloudAccountSection";
import { GOOGLE_ACCOUNT } from "../lib/cloudAccounts";
import SourceGlyph from "./SourceGlyph";
import Spinner from "./Spinner";
import { attempt } from "../hooks/useGitHub";
import { providerFailureKey } from "../hooks/useWorkspace";
import { googleAccount, type DriveFoldersResult, type DriveLocation, type GoogleBridge } from "../lib/workspaceClient";

interface Props {
  /// The Google half of the shell, or null in the browser preview.
  bridge: GoogleBridge | null;
  onCancel: () => void;
  /// The folder the user chose. Opening it is the workspace's business, not this dialog's.
  onOpen: (ref: WorkspaceRef) => void;
}

/// One step of the breadcrumb: where the user went. `id` is the Drive id to list and open - My Drive
/// is `root`, and Shared with me has none, being a place of its own rather than a folder.
interface Place {
  kind: "my-drive" | "shared-with-me" | "shared-drive" | "folder";
  id: string | null;
  name: string;
  /// The Shared Drive this place is in, when the trail went through one.
  driveId: string | null;
  /// Whether Drive calls it shared, or the trail reached it through Shared with me.
  shared: boolean;
}

type Folder = { id: string; name: string; shared: boolean };

/// What a request came back with. "Loading" is not stored: it is whatever is left when the answer on
/// hand was for a different request than the one now wanted, which spares the effect a synchronous
/// `setState` on every step.
type Listing = { state: "connect" } | { state: "failed"; errorKey: string } | { state: "loaded"; folders: Folder[] };

/// What to ask the shell to list for a place. The top level, which is no place, lists the Shared
/// Drives - My Drive and Shared with me are fixed rows that need no listing.
function locationOf(place: Place | null): DriveLocation {
  if (place === null) return { in: "drives" };
  if (place.kind === "shared-with-me" || place.id === null) return { in: "shared-with-me" };
  return { in: "folder", id: place.id };
}

function glyphKindOf(place: Place): DriveGlyphKind {
  switch (place.kind) {
    case "my-drive":
      return "my-drive";
    case "shared-with-me":
      return "shared-with-me";
    case "shared-drive":
      return "shared-drive";
    case "folder":
      return place.shared ? "shared-folder" : "folder";
  }
}

/// Choosing a Google Drive folder to open as a workspace.
///
/// The top level is three kinds of entry - My Drive, Shared with me, and a row per Shared Drive -
/// each with its own icon. Below it the picker browses folders only, through `google:folders`.
/// "Open this folder" is offered anywhere but the top level and Shared with me, neither of which is
/// a folder. With no account connected, it shows the same connect control as Settings, and carries
/// on once one is.
export default function OpenDriveDialog({ bridge, onCancel, onOpen }: Props) {
  const { t } = useTranslation();
  const [trail, setTrail] = useState<Place[]>([]);
  const [answer, setAnswer] = useState<{ request: string; listing: Listing } | null>(null);
  const [reloads, setReloads] = useState(0);
  // Memoised so the account hook's effect does not re-run on every render.
  const googleCalls = useMemo(() => googleAccount(bridge), [bridge]);
  const here = trail.at(-1) ?? null;
  const request = `${here === null ? "top" : `${here.kind}:${here.id ?? ""}`}#${reloads}`;
  const listing: Listing | { state: "loading" } = answer !== null && answer.request === request ? answer.listing : { state: "loading" };

  useEffect(() => {
    if (bridge === null) return;
    let live = true;
    void (async () => {
      const result: DriveFoldersResult = await attempt(() => bridge.listDriveFolders(locationOf(here)));
      if (!live) return;
      if (result.ok) {
        setAnswer({ request, listing: { state: "loaded", folders: result.folders } });
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

  const canOpen = here !== null && here.kind !== "shared-with-me";
  // A folder shows as shared when Drive says so, or when it sits under something that is.
  const underShared = here !== null && (here.kind === "shared-with-me" || here.shared);

  const open = () => {
    if (here === null || here.kind === "shared-with-me" || here.id === null) return;
    onOpen({
      kind: "google-drive",
      folderId: here.id,
      ...(here.driveId === null ? {} : { driveId: here.driveId }),
      name: here.name,
    });
  };

  // A crumb you can go back to reads as a link: the accent, underlined, a pointer, and a focus ring.
  const crumbLinkClass =
    "cursor-pointer rounded px-1 text-accent underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
  const rowClass = "flex w-full items-center gap-2 truncate px-2 py-1 text-left text-ui text-ink hover:bg-hover";

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
      <div className="flex max-h-full w-[56rem] max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-rule bg-app p-4 shadow-menu">
        <div className="flex items-center gap-2">
          <SourceGlyph mark="google-drive" className="size-5 text-drive" />
          <h2 className="text-sm font-semibold text-ink">{t("drive.title")}</h2>
        </div>

        {bridge === null || listing.state === "connect" ? (
          <CloudAccountSection kind={GOOGLE_ACCOUNT} bridge={googleCalls} onConnected={() => setReloads((count) => count + 1)} />
        ) : (
          <>
            <nav aria-label={t("drive.root")} className="mt-3 flex flex-wrap items-center gap-1 text-xs text-ink-3">
              {here === null ? (
                <span aria-current="page" className="px-1">
                  {t("drive.root")}
                </span>
              ) : (
                <button type="button" className={crumbLinkClass} onClick={() => setTrail([])}>
                  {t("drive.root")}
                </button>
              )}
              {trail.map((place, index) => {
                const current = index === trail.length - 1;
                const content = (
                  <>
                    {index === 0 && <DriveGlyph kind={glyphKindOf(place)} className="size-3.5 text-drive" />}
                    {place.name}
                  </>
                );
                return (
                  <span key={`${place.kind}:${place.id ?? ""}`} className="flex items-center gap-1">
                    <span aria-hidden="true">/</span>
                    {current ? (
                      <span aria-current="page" className="flex items-center gap-1 px-1">
                        {content}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={`flex items-center gap-1 ${crumbLinkClass}`}
                        onClick={() => setTrail((previous) => previous.slice(0, index + 1))}
                      >
                        {content}
                      </button>
                    )}
                  </span>
                );
              })}
            </nav>

            <div className="mt-2 h-[32rem] max-h-[70vh] overflow-y-auto rounded border border-rule">
              {here === null && (
                <ul>
                  <li>
                    <button
                      type="button"
                      className={rowClass}
                      onClick={() => enter({ kind: "my-drive", id: "root", name: t("drive.myDrive"), driveId: null, shared: false })}
                    >
                      <DriveGlyph kind="my-drive" className="size-4 shrink-0 text-drive" />
                      {t("drive.myDrive")}
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className={rowClass}
                      onClick={() =>
                        enter({ kind: "shared-with-me", id: null, name: t("drive.sharedWithMe"), driveId: null, shared: true })
                      }
                    >
                      <DriveGlyph kind="shared-with-me" className="size-4 shrink-0 text-drive" />
                      {t("drive.sharedWithMe")}
                    </button>
                  </li>
                </ul>
              )}
              {here === null && listing.state === "loaded" && listing.folders.length > 0 && (
                <h3 className="px-2 pt-2 text-xs font-medium text-ink-4">{t("drive.sharedDrives")}</h3>
              )}
              {listing.state === "loading" && (
                <p className="flex items-center gap-2 p-2 text-xs text-ink-3">
                  <Spinner label={t("drive.loading")} />
                  {t("drive.loading")}
                </p>
              )}
              {listing.state === "failed" && (
                <p role="alert" className="m-2 rounded border border-rule bg-panel p-2 text-xs text-ink-2">
                  {t(listing.errorKey)}
                </p>
              )}
              {listing.state === "loaded" && (
                <>
                  <ul>
                    {listing.folders.map((folder) => {
                      const shared = folder.shared || underShared;
                      return (
                        <li key={folder.id}>
                          <button
                            type="button"
                            className={rowClass}
                            onClick={() =>
                              enter(
                                here === null
                                  ? { kind: "shared-drive", id: folder.id, name: folder.name, driveId: folder.id, shared: false }
                                  : { kind: "folder", id: folder.id, name: folder.name, driveId: here.driveId, shared },
                              )
                            }
                          >
                            <DriveGlyph
                              kind={here === null ? "shared-drive" : shared ? "shared-folder" : "folder"}
                              className={`size-4 shrink-0 ${here === null ? "text-drive" : "text-ink-3"}`}
                            />
                            {folder.name}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {here !== null && listing.folders.length === 0 && (
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
          {canOpen && listing.state !== "connect" && (
            <button type="button" onClick={open} className="rounded bg-accent px-3 py-1 text-ui text-on-accent">
              {t("drive.openThis")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
