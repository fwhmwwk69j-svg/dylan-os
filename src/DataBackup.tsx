import { parseExportStatus } from "./daily";
import { useState, useRef } from "react";
import {
  EXPORT_STATUS_KEY,
  workspaceContent,
  type ExportStatus,
} from "./daily";
import type { State } from "./data";
import {
  exportWorkspace,
  backupFilename,
  parseImport,
  summary,
  snapshots,
  SCHEMA_VERSION,
  EXPORT_KEY,
  MAX_IMPORT_BYTES,
  STORAGE_KEY,
  type Snapshot,
} from "./safety";
export function downloadJson(raw: string, filename: string) {
  const url = URL.createObjectURL(
    new Blob([raw], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function DataBackup({
  data,
  loadError,
  onReplace,
  onClear,
  onExportChange,
}: {
  data: State;
  loadError: string;
  onReplace: (next: State, reason: string) => Promise<boolean>;
  onClear: (confirmation: string) => Promise<boolean>;
  onExportChange: (status: ExportStatus) => void;
}) {
  const importSequence = useRef(0);
  const [confirmationPending, setConfirmationPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<{
    state: State;
    source: string;
  } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [clear, setClear] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [revision, refresh] = useState(0);
  let history: Snapshot[] = [];
  let storageError = "";
  let lastExport: string | null = null;
  let status: ExportStatus | null = null;
  try {
    history = snapshots(localStorage);
    lastExport = localStorage.getItem(EXPORT_KEY);
    status = parseExportStatus(localStorage.getItem(EXPORT_STATUS_KEY));
  } catch (e) {
    storageError = (e as Error).message;
  }
  async function importFile(file?: File) {
    const sequence = ++importSequence.current;
    setError("");
    setMessage("");
    setPreview(null);
    setConfirm(false);
    if (!file) return;
    try {
      if (file.size > MAX_IMPORT_BYTES)
        throw new Error("Backup exceeds the 5 MB import limit.");
      const state = parseImport(await file.text());
      if (sequence !== importSequence.current) return;
      setPreview({ state, source: `Import ${file.name}` });
      setClear(false);
    } catch (e) {
      if (sequence === importSequence.current)
        setError(`Import rejected: ${(e as Error).message}`);
    }
  }
  function exportFile() {
    setError("");
    setMessage("");
    try {
      const now = new Date();
      downloadJson(
        JSON.stringify(exportWorkspace(data, now), null, 2),
        backupFilename(now),
      );
      try {
        localStorage.setItem(EXPORT_KEY, now.toISOString());
        const metadata: ExportStatus = {
          requestedAt: now.toISOString(),
          content: workspaceContent(data),
        };
        localStorage.setItem(EXPORT_STATUS_KEY, JSON.stringify(metadata));
        onExportChange(metadata);
        setConfirmationPending(true);
      } catch {
        setError("Download started, but its timestamp could not be saved.");
      }
      setMessage(
        "Backup download started. Keep the downloaded file somewhere safe.",
      );
      refresh(revision + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function viewSnapshot(snapshot: Snapshot) {
    importSequence.current++;
    setError("");
    setMessage("");
    setPreview(null);
    setConfirm(false);
    try {
      setPreview({
        state: parseImport(snapshot.raw),
        source: `Restore snapshot: ${snapshot.reason}`,
      });
      setClear(false);
    } catch (e) {
      setError(
        `Snapshot cannot be restored: ${(e as Error).message} Download its original JSON to inspect it.`,
      );
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR RECORDS, IN YOUR HANDS</div>
          <h1>Data & Backup</h1>
          <p>Back up, review, and recover your personal workspace.</p>
        </div>
        <span className="pill">SCHEMA {SCHEMA_VERSION}</span>
      </div>
      {(error || storageError) && (
        <div className="banner" role="alert">
          {error || storageError}
        </div>
      )}
      {message && (
        <p role="status" className="tip">
          {message}
        </p>
      )}
      <div className="two-grid">
        <section className="card">
          <div className="card-heading">
            <h2>Export workspace</h2>
          </div>
          <p className="muted">
            A complete JSON file containing all records, notes, grades, history,
            goals, schema version, and export timestamp. Unknown fields are
            preserved.
          </p>
          <button
            className="primary"
            disabled={!!loadError}
            onClick={exportFile}
          >
            Export workspace
          </button>
          {loadError && (
            <button
              className="secondary"
              onClick={() => {
                try {
                  downloadJson(
                    localStorage.getItem(STORAGE_KEY) || "null",
                    "dylan-os-original-data.json",
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Download original saved data
            </button>
          )}
          <p className="row-meta">
            Last export started:{" "}
            {lastExport ? new Date(lastExport).toLocaleString() : "Never"}. A
            download request cannot verify that the file was saved.
          </p>
        </section>
        <section className="card">
          <div className="card-heading">
            <h2>Import workspace</h2>
          </div>
          <p className="muted">
            Choose a Dylan OS JSON file. Validation and a preview come first.
            Replacement requires confirmation and a local snapshot.
          </p>
          <label className="file-picker">
            Choose backup file
            <input
              type="file"
              accept=".json,application/json"
              aria-label="Import workspace file"
              onChange={(e) => {
                importFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <p className="row-meta">
            Schemas 1–5 supported · maximum 5 MB · legacy workspace JSON
            accepted.
          </p>
        </section>
      </div>
      {preview && (
        <section className="card import-preview">
          <div className="card-heading">
            <h2>Review before replacing</h2>
          </div>
          <p className="muted">{preview.source}</p>
          <div className="backup-counts">
            {Object.entries(summary(preview.state)).map(([key, count]) => (
              <span key={key}>
                <strong>{count}</strong>{" "}
                {key === "assignments"
                  ? "assignments/exams"
                  : key === "weeklyReflections"
                    ? "weekly reflections"
                    : key}
              </span>
            ))}
          </div>
          <p className="muted">
            Goal weight:{" "}
            {preview.state.goalWeight === null
              ? "Not set"
              : `${preview.state.goalWeight} lb`}
            . Fitness goals:{" "}
            {preview.state.fitnessGoals
              ? Object.entries(preview.state.fitnessGoals)
                  .filter(
                    ([key, value]) =>
                      [
                        "calories",
                        "protein",
                        "steps",
                        "weeklyWorkouts",
                      ].includes(key) && value !== null,
                  )
                  .map(([key, value]) => `${key}: ${value}`)
                  .join(" · ") || "None set"
              : "None set"}
            . Notes, grades, preferences, and history travel with their records.
            Current data will be replaced; a snapshot must be saved first.
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
            />{" "}
            I understand this replaces my current workspace.
          </label>
          <div className="heading-actions">
            <button className="secondary" onClick={() => setPreview(null)}>
              Cancel replacement
            </button>
            <button
              className="primary"
              disabled={!confirm}
              onClick={async () => {
                if (await onReplace(preview.state, preview.source)) {
                  setPreview(null);
                  setMessage(
                    "Workspace restored. Your previous workspace is in local snapshots.",
                  );
                  refresh(revision + 1);
                } else
                  setError(
                    "Replacement failed. Current data was kept. Check the storage error above.",
                  );
              }}
            >
              Confirm replacement
            </button>
          </div>
        </section>
      )}
      <section className="card">
        <div className="card-heading">
          <div>
            <h2>Backup status & local snapshots</h2>
            <p>
              Newest five snapshots · taken before deletions, imports, restores,
              and clearing.
            </p>
          </div>
        </div>
        <p className="muted">
          {status?.confirmedAt
            ? `Last user-confirmed saved file: ${new Date(status.confirmedAt).toLocaleString()}`
            : "No external backup has been confirmed saved."}
        </p>
        <p className="muted">
          {status
            ? workspaceContent(data) === status.content
              ? "Workspace unchanged since last export request."
              : "Workspace changed since last export request."
            : "Export your workspace to establish backup status."}
        </p>
        {confirmationPending && (
          <div className="backup-confirm">
            <p className="muted">
              Did the download finish and did you keep the file outside this
              browser? This is your confirmation, not an automatic check.
            </p>
            <button
              className="secondary"
              onClick={() => {
                try {
                  if (!status) throw new Error("Export status is missing.");
                  const saved = {
                    ...status,
                    confirmedAt: new Date().toISOString(),
                  };
                  localStorage.setItem(
                    EXPORT_STATUS_KEY,
                    JSON.stringify(saved),
                  );
                  onExportChange(saved);
                  setConfirmationPending(false);
                  setMessage(
                    "You confirmed that the downloaded backup was saved.",
                  );
                  refresh(revision + 1);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              I saved the backup file
            </button>
            <button
              className="subtle-link"
              onClick={() => setConfirmationPending(false)}
            >
              Not yet
            </button>
          </div>
        )}
        <p className="muted">
          Current schema: {SCHEMA_VERSION}. Last local backup:{" "}
          {history[0]
            ? new Date(history[0].createdAt).toLocaleString()
            : "No snapshots yet"}
          .
        </p>
        <p className="muted">
          Local snapshots share this browser’s storage. They cannot protect
          against clearing site data, device loss, or a full browser reset. Keep
          an exported file outside this browser.
        </p>
        {history.map((snapshot) => (
          <div className="snapshot-row" key={snapshot.id}>
            <div className="row-grow">
              <strong>{snapshot.reason}</strong>
              <p className="row-meta">
                {new Date(snapshot.createdAt).toLocaleString()}
              </p>
            </div>
            <button
              className="secondary"
              onClick={() => viewSnapshot(snapshot)}
            >
              Restore backup
            </button>
            <button
              className="subtle-link"
              onClick={() =>
                downloadJson(
                  snapshot.raw,
                  `dylan-os-snapshot-${snapshot.createdAt.slice(0, 10)}.json`,
                )
              }
            >
              Download
            </button>
          </div>
        ))}
        {!history.length && (
          <p className="empty">
            Snapshots will appear after your first destructive change.
          </p>
        )}
      </section>
      <section className="card clear-card">
        <div className="card-heading">
          <h2>Clear workspace</h2>
        </div>
        <p className="muted">
          Remove all active records. Your theme and existing snapshots stay. A
          fresh snapshot is required immediately before clearing.
        </p>
        {!clear ? (
          <button
            className="secondary danger"
            onClick={() => {
              setClear(true);
              setPhrase("");
              setPreview(null);
            }}
          >
            Clear workspace
          </button>
        ) : (
          <div>
            <label className="check-in-date">
              Type CLEAR MY WORKSPACE to confirm
              <input
                aria-label="Clear confirmation"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                autoComplete="off"
              />
            </label>
            <div className="heading-actions">
              <button className="secondary" onClick={() => setClear(false)}>
                Cancel clear
              </button>
              <button
                className="primary"
                disabled={phrase !== "CLEAR MY WORKSPACE"}
                onClick={async () => {
                  if (await onClear(phrase)) {
                    setClear(false);
                    setPhrase("");
                    setMessage(
                      "Workspace cleared. Restore it from the snapshot below if needed.",
                    );
                    refresh(revision + 1);
                  } else
                    setError(
                      "Clearing failed. Your workspace was kept. A backup must be saved first.",
                    );
                }}
              >
                Confirm clear workspace
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
