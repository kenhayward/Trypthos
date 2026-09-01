import { APP_NAME, APP_VERSION, CAPABILITIES, DISCLAIMERS } from "../lib/appInfo";

interface Props {
  open: boolean;
  onClose: () => void;
}

/// Reads lib/appInfo only. It must never import the release notes: doing so would pull the release
/// history into the initial bundle, since the About box is eager.
export default function AboutModal({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`About ${APP_NAME}`}
      className="fixed inset-0 flex items-center justify-center bg-neutral-900/40 p-4"
    >
      <div className="max-h-full w-full max-w-lg overflow-auto rounded-lg bg-white p-6 shadow-xl">
        <h1 className="text-lg font-semibold text-neutral-900">{APP_NAME}</h1>
        <p className="mt-1 text-sm text-neutral-500">Version {APP_VERSION}</p>

        <pre className="mt-4 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-neutral-700">
          {CAPABILITIES}
        </pre>

        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-neutral-500">
          {DISCLAIMERS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        <button
          type="button"
          onClick={onClose}
          className="mt-6 rounded bg-neutral-900 px-3 py-1.5 text-sm text-white"
        >
          Close
        </button>
      </div>
    </div>
  );
}
