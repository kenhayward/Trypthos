import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useZoomPan } from "../hooks/useZoomPan";
import type { ZoomDirection } from "../lib/zoom";

interface Props {
  /// The picture, as a data URL. The main process read the file; nothing here touches the disk.
  source: string;
  /// Names the picture for assistive technology - the path it was opened from.
  name: string;
  /// 1 is the picture's own pixels. Applied to its natural size rather than to the panel, so 100%
  /// means the same thing here as it does anywhere else that shows an image.
  zoom: number;
  onZoom: (direction: ZoomDirection) => void;
}

/// A picture, drawn rather than edited.
///
/// It is shown at its own size and panned within the panel rather than shrunk to fit, because a
/// screenshot scaled down to a side panel is a screenshot you cannot read. That was already true
/// before there was a zoom; what zoom adds is the way back out of it.
///
/// The scaling is done by setting a width and height in pixels, not by `transform`. A transform
/// paints the picture larger and leaves the layout box the size it was, so the surface has nothing
/// to scroll and a zoomed-in picture cannot be panned - which is half the feature.
export default function ImageViewer({ source, name, zoom, onZoom }: Props) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  useZoomPan({ host, onZoom });

  /// The picture's own pixels, once the browser has them.
  ///
  /// Null until it loads, and the picture is drawn with no width at all until then - which is its
  /// natural size, and is what it should be at 100% anyway. Guessing a size here would show the
  /// wrong one for a frame on every image opened.
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);

  return (
    <div ref={host} className="h-full overflow-auto bg-sunken p-4">
      <img
        src={source}
        alt={t("editor.imageAlt", { name })}
        onLoad={(event) => {
          const image = event.currentTarget;
          // A picture that failed to decode reports zero, and a zero width would scale to a
          // picture that is not there.
          if (image.naturalWidth > 0) {
            setNatural({ width: image.naturalWidth, height: image.naturalHeight });
          }
        }}
        className="mx-auto block"
        style={{
          // The same variable the text surfaces carry the level in, so "how far in am I" is one
          // thing in the DOM rather than three. Here it is multiplied by the picture's own pixels
          // rather than by a font size.
          ["--tp-zoom" as string]: zoom,
          maxWidth: "none",
          ...(natural === null
            ? {}
            : {
                width: `calc(${natural.width}px * var(--tp-zoom))`,
                height: `calc(${natural.height}px * var(--tp-zoom))`,
              }),
        }}
      />
    </div>
  );
}
