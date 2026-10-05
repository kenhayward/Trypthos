import { useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import type { MediaKind } from "@trypthos/domain";

interface Props {
  /// Where the main process serves the file, as a `tp-media://` URL. Nothing here touches the disk
  /// and nothing here holds the bytes: the engine fetches ranges as it needs them, which is why a
  /// four gigabyte recording opens as quickly as a four megabyte one.
  source: string;
  kind: MediaKind;
  /// The path it was opened from. The accessible name, and for a sound the only thing on screen
  /// that says which file is playing.
  name: string;
}

/// Which `MediaError` codes mean "this computer has no decoder for that".
///
/// 3 is `MEDIA_ERR_DECODE` and 4 is `MEDIA_ERR_SRC_NOT_SUPPORTED`. These two are the formats the
/// catalogue knowingly admits and cannot always play - a Matroska file carrying VP9, an MP4
/// carrying AC-3 audio. They are not failures to FIND the file, and saying "it could not be read"
/// about one would send somebody looking for a problem that is not there.
const UNDECODABLE = new Set([3, 4]);

/// A recording, played rather than edited.
///
/// Deliberately NO zoom and no pan, unlike the image viewer beside it. A screenshot shrunk into a
/// side panel is a screenshot you cannot read, which is the whole reason a picture pans; a video is
/// watched at the panel's size, and the way to make it bigger is fullscreen.
///
/// The controls are Chromium's own, which is a decision rather than a shortcut. The native bar
/// carries play, a scrub bar, elapsed and total, volume, playback speed, Picture-in-Picture and
/// fullscreen, every one of them keyboard reachable and labelled in the user's language. Building
/// that bar by hand would mean rewriting all of its accessibility to gain colour tokens.
export default function MediaPlayer({ source, kind, name }: Props) {
  const { t } = useTranslation();
  const [failure, setFailure] = useState<"undecodable" | "unreadable" | null>(null);

  const onError = (event: SyntheticEvent<HTMLMediaElement>) => {
    const code = event.currentTarget.error?.code ?? 0;
    setFailure(UNDECODABLE.has(code) ? "undecodable" : "unreadable");
  };

  if (failure !== null) {
    return (
      <div className="flex h-full items-center justify-center bg-sunken p-6">
        <p className="max-w-md text-center text-ink-3">
          {failure === "undecodable" ? t("editor.mediaUndecodable") : t("editor.mediaUnreadable")}
        </p>
      </div>
    );
  }

  if (kind === "video") {
    return (
      <div className="flex h-full items-center justify-center bg-sunken p-4">
        {/* `preload="metadata"` and no autoplay: opening a tab fetches a duration and a first
            frame, not the file, and never starts making noise on its own. */}
        <video
          src={source}
          controls
          preload="metadata"
          aria-label={t("editor.videoLabel", { name })}
          onError={onError}
          className="max-h-full max-w-full"
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-sunken p-4">
      <p className="max-w-full truncate text-ink-2" title={name}>
        {name}
      </p>
      <audio
        src={source}
        controls
        preload="metadata"
        aria-label={t("editor.audioLabel", { name })}
        onError={onError}
        className="w-full max-w-xl"
      />
    </div>
  );
}
