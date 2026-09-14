import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import EditorPanel from "./components/EditorPanel";
import { useSettings } from "./hooks/useSettings";
import { useWorkspace } from "./hooks/useWorkspace";
import { draftFrom } from "./lib/documentDraft";
import { settingsBridge, workspaceClient } from "./lib/workspaceClient";
import { windowControls } from "./lib/windowControls";

interface Props {
  /// The main process supplies both values after resolving the renderer's qualified path against an
  /// already-open workspace. This renderer only reopens that known local workspace and file.
  root: string;
  file: string;
}

/// The contents of an auxiliary document window.
///
/// It deliberately shares the ordinary workspace hook and editor surface rather than growing a
/// second save implementation. The only thing removed is surrounding application chrome: this
/// window owns one file, not a set of tabs, a folder browser or a chat conversation.
export default function SingleDocumentWindow({ root, file }: Props) {
  const { t } = useTranslation();
  const client = useMemo(() => workspaceClient(), []);
  const bridge = useMemo(() => settingsBridge(), []);
  const { settings } = useSettings(bridge);
  const { state, actions } = useWorkspace(client, "", (name) => windowControls().confirmDiscard(name));
  const opened = useRef(false);

  // StrictMode mounts effects twice in development. Opening a document a second time would re-read
  // it and overwrite edits, so this window opens its one target exactly once.
  //
  // A window a tab was moved into claims that tab's unsaved text first - once, which is also why the
  // guard above matters: a second claim would find nothing and open the file from disk instead. The
  // tab it came from closes only once this claim has been made.
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    void (async () => {
      const draft = draftFrom(await client.takeDocumentDraft());
      await actions.openTarget({ root, file, draft });
    })();
  }, [actions, client, file, root]);

  useEffect(() => {
    void windowControls().setDocumentDirty(state.anyDirty);
  }, [state.anyDirty]);

  useEffect(
    () =>
      windowControls().onCloseRequested(() => {
        void (async () => {
          if (await actions.mayDiscard()) await windowControls().closeWindow(true);
        })();
      }),
    [actions],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (event.shiftKey) void actions.saveAs();
      else void actions.save();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions]);

  if (state.activePath === null) {
    if (state.errorKey !== null) {
      return (
        <main className="flex h-screen items-center justify-center bg-app p-6" role="alert">
          {t(state.errorKey, state.errorParams ?? {})}
        </main>
      );
    }
    return <main className="h-screen bg-app" aria-busy="true" />;
  }

  return (
    <EditorPanel
      singleDocument
      workspaceName={null}
      paths={[]}
      activePath={state.activePath}
      dirty={state.dirty}
      value={state.content}
      readOnly={state.readOnly}
      media={state.media}
      readImage={client.readImage}
      onChange={actions.edit}
      defaultMode={settings.editor.defaultViewMode}
      fileTypes={settings.fileTypes.enabled}
    />
  );
}
