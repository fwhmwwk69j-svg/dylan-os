import { useEffect, useRef, useState } from "react";

export default function CourseNotes({
  notes,
  onSave,
}: {
  notes: string;
  onSave: (notes: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(notes);
  const [status, setStatus] = useState("Saved on this device.");
  const latest = useRef(draft);
  const saved = useRef(notes);
  const saving = useRef(false);
  const commit = useRef(onSave);
  commit.current = onSave;
  latest.current = draft;
  async function save() {
    if (saving.current || latest.current === saved.current) return;
    saving.current = true;
    const value = latest.current;
    setStatus("Saving…");
    const success = await commit.current(value);
    saving.current = false;
    if (success) {
      saved.current = value;
      setStatus(
        latest.current === value ? "Saved on this device." : "Unsaved changes.",
      );
      if (latest.current !== value) void save();
    } else
      setStatus(
        "Not saved. Keep these notes before reloading; resolve the workspace warning and try again.",
      );
  }
  useEffect(() => {
    if (draft === saved.current) return;
    const timer = setTimeout(() => void save(), 400);
    return () => clearTimeout(timer);
  }, [draft]);
  return (
    <>
      <textarea
        className="notes"
        aria-label="Course notes"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setStatus("Unsaved changes.");
        }}
        onBlur={() => void save()}
      />
      <p className="row-meta" role="status">
        {status}
      </p>
      <button className="subtle-link" onClick={() => void save()}>
        Save notes
      </button>
    </>
  );
}
