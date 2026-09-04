/// Handing a web address to the user's browser.
///
/// Its own module rather than part of `windowControls`, because the fallback is the interesting part
/// and it is not a window control's kind of fallback. Outside the desktop shell the app runs in an
/// ordinary browser tab, where opening a link in a new tab is exactly what the platform already does
/// - so the fallback here does the real thing rather than nothing.
///
/// `noopener` is not optional on that path: without it the opened page gets a handle to the window
/// that opened it, and can navigate this one wherever it likes.

interface ExternalBridge {
  openExternal?: (url: string) => Promise<unknown>;
}

export function openExternal(url: string): void {
  const bridge = (window as unknown as { trypthos?: ExternalBridge }).trypthos;
  if (bridge?.openExternal) {
    void bridge.openExternal(url);
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}
