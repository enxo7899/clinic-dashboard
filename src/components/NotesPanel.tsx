"use client";
import { useEffect, useState } from "react";
import { useClinic } from "./ClinicProvider";
import { LockedPanel } from "./Notice";
import { prettyDateTime } from "../lib/time";
import type { Note, Staff, Violation } from "../lib/types";

/** Clinical notes. For the wrong role this renders the rule instead of the data: the adapter decides, not the screen. */
export function NotesPanel({ patientId, staff }: { patientId: string; staff: Staff[] }) {
  const { adapter, actor, rev, bump, say, showRule } = useClinic();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [denied, setDenied] = useState<Violation[] | null>(null);
  const [text, setText] = useState("");

  useEffect(() => {
    if (!actor) return;
    let live = true;
    adapter.listNotes(actor, patientId).then((r) => {
      if (!live) return;
      if (r.ok) { setNotes(r.value); setDenied(null); } else { setNotes(null); setDenied(r.violations); }
    });
    return () => { live = false; };
  }, [adapter, actor, patientId, rev]);

  if (denied) return <LockedPanel title="Clinical notes" message={denied[0].message} />;
  if (!notes) return <p className="muted">Loading notes…</p>;
  const name = (id: string) => staff.find((s) => s.id === id)?.name ?? "Staff";
  return (
    <div className="notes">
      <h3>Clinical notes</h3>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await adapter.addNote(actor!, patientId, text);
          if (r.ok) { setText(""); bump(); say("Note saved."); } else showRule("Note not saved", r.violations, r.kind);
        }}
      >
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Write a note for this patient's chart" aria-label="New clinical note" />
        <button className="btn sm" type="submit" disabled={!text.trim()}>Add note</button>
      </form>
      {notes.length === 0 ? (
        <p className="muted">No notes yet for this patient.</p>
      ) : (
        <ul className="note-list">
          {notes.map((n) => (
            <li key={n.id}>
              <div className="meta"><span className="mono">{prettyDateTime(n.at)}</span> · {name(n.authorId)}</div>
              <p>{n.text}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
