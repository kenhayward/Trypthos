import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspaceRef } from "@trypthos/domain";
import CloudAccountSection from "./CloudAccountSection";
import SourceGlyph from "./SourceGlyph";
import Spinner from "./Spinner";
import { attempt } from "../hooks/useGitHub";
import type { CloudFolder, CloudFolderSource, CloudPlace } from "../lib/cloudFolders";

interface Props {
  /// Which provider's places, and how to list and open them. Memoised by the caller: it is an effect
  /// dependency, and a fresh one each render would list again each render.
  source: CloudFolderSource;
  onCancel: () => void;
  /// The folder the user chose. Opening it is the workspace's business, not this dialog's.
  onOpen: (ref: WorkspaceRef) => void;
}

/// What a request came back with. "Loading" is not stored: it is whatever is left when the answer on
/// hand was for a different request than the one now wanted, which spares the effect a synchronous
/// `setState` on every step.
type Listing =
  | { state: "connect" }
  | { state: "failed"; errorKey: string }
  | { state: "loaded"; folders: CloudFolder[]; driveId: string | null };

function placeKey(place: CloudPlace): string {
  return `${place.kind}:${place.driveId ?? ""}:${place.id ?? ""}`;
}

/// Choosing a cloud folder to open as a workspace - Google Drive's or OneDrive's, by the source given.
///
/// The top level is the source's fixed places (My Drive and Shared with me; My files and Shared with
/// me), each with its own icon, then whatever the source lists there (Drive's shared drives). Below it
/// the picker browses folders only, with a breadcrumb. "Open this folder" is offered wherever the
/// source says the place opens as a workspace. With no account connected it shows the same connect
/// control as Settings, and carries on once one is.
export default function OpenCloudFolderDialog({ source, onCancel, onOpen }: Props) {
  const { t } = useTranslation();
  const [trail, setTrail] = useState<CloudPlace[]>([]);
  const [answer, setAnswer] = useState<{ request: string; listing: Listing } | null>(null);
  const [reloads, setReloads] = useState(0);
  const here = trail.at(-1) ?? null;
  const request = `${here === null ? "top" : placeKey(here)}#${reloads}`;
  const listing: Listing | { state: "loading" } = answer !== null && answer.request === request ? answer.listing : { state: "loading" };

  useEffect(() => {
    if (source.accountCalls === null) return;
    let live = true;
    void (async () => {
      const result = await attempt(() => source.list(here));
      if (!live) return;
      if (result.ok) {
        setAnswer({ request, listing: { state: "loaded", folders: result.folders, driveId: result.driveId ?? null } });
      } else if (result.reason === "not-connected" || result.reason === "not-configured") {
        setAnswer({ request, listing: { state: "connect" } });
      } else {
        setAnswer({ request, listing: { state: "failed", errorKey: source.failureKey(result.reason) } });
      }
    })();
    return () => {
      live = false;
    };
  }, [source, here, request]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const enter = useCallback((place: CloudPlace) => setTrail((previous) => [...previous, place]), []);

  // The place itself, with the drive its listing named when the place did not know one yet.
  const listedDriveId = listing.state === "loaded" ? listing.driveId : null;
  const target = here === null ? null : here.driveId === null && listedDriveId !== null ? { ...here, driveId: listedDriveId } : here;
  const ref = target === null ? null : source.refFor(target);

  const open = () => {
    if (ref !== null) onOpen(ref);
  };

  // A crumb you can go back to reads as a link: the accent, underlined, a pointer, and a focus ring.
  const crumbLinkClass =
    "cursor-pointer rounded px-1 text-accent underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
  const rowClass = "flex w-full items-center gap-2 truncate px-2 py-1 text-left text-ui text-ink hover:bg-hover";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t(source.titleKey)}
      // Flex, not a grid, for the reason `OpenRepoDialog` gives: a grid row is sized to the unclipped
      // panel and draws a tall one off the bottom of the window.
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="flex max-h-full w-[56rem] max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-rule bg-app p-4 shadow-menu">
        <div className="flex items-center gap-2">
          <SourceGlyph mark={source.mark} className={`size-5 ${source.markClass}`} />
          <h2 className="text-sm font-semibold text-ink">{t(source.titleKey)}</h2>
        </div>

        {source.accountCalls === null || listing.state === "connect" ? (
          <CloudAccountSection kind={source.account} bridge={source.accountCalls} onConnected={() => setReloads((count) => count + 1)} />
        ) : (
          <>
            <nav aria-label={t(source.rootKey)} className="mt-3 flex flex-wrap items-center gap-1 text-xs text-ink-3">
              {here === null ? (
                <span aria-current="page" className="px-1">
                  {t(source.rootKey)}
                </span>
              ) : (
                <button type="button" className={crumbLinkClass} onClick={() => setTrail([])}>
                  {t(source.rootKey)}
                </button>
              )}
              {trail.map((place, index) => {
                const current = index === trail.length - 1;
                const content = (
                  <>
                    {index === 0 && source.glyph(place, `size-3.5 ${source.markClass}`)}
                    {place.name}
                  </>
                );
                return (
                  <span key={placeKey(place)} className="flex items-center gap-1">
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
                  {source.roots.map((root) => {
                    const place: CloudPlace = { kind: root.kind, id: root.id, name: t(root.nameKey), driveId: null, shared: root.shared };
                    return (
                      <li key={root.kind}>
                        <button type="button" className={rowClass} onClick={() => enter(place)}>
                          {source.glyph(place, `size-4 shrink-0 ${source.markClass}`)}
                          {place.name}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {here === null && source.topHeadingKey !== null && listing.state === "loaded" && listing.folders.length > 0 && (
                <h3 className="px-2 pt-2 text-xs font-medium text-ink-4">{t(source.topHeadingKey)}</h3>
              )}
              {listing.state === "loading" && (
                <p className="flex items-center gap-2 p-2 text-xs text-ink-3">
                  <Spinner label={t("cloud.loadingFolders")} />
                  {t("cloud.loadingFolders")}
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
                      const place = source.enter(here, folder);
                      return (
                        <li key={`${folder.driveId ?? ""}:${folder.id}`}>
                          <button type="button" className={rowClass} onClick={() => enter(place)}>
                            {source.glyph(place, `size-4 shrink-0 ${here === null ? source.markClass : "text-ink-3"}`)}
                            {folder.name}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {here !== null && listing.folders.length === 0 && <p className="p-2 text-xs text-ink-3">{t("cloud.noFolders")}</p>}
                </>
              )}
            </div>

            <p className="mt-2 text-xs text-ink-4">{t(source.readOnlyNoteKey)}</p>
          </>
        )}

        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded border border-rule px-3 py-1 text-ui text-ink hover:bg-hover">
            {t("cloud.cancel")}
          </button>
          {ref !== null && listing.state !== "connect" && (
            <button type="button" onClick={open} className="rounded bg-accent px-3 py-1 text-ui text-on-accent">
              {t("cloud.openThisFolder")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
