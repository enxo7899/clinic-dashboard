"use client";
import { useState } from "react";
import { useClinic } from "./ClinicProvider";
import { Lock } from "./Notice";
import type { RefData } from "./hooks";
import { addDays, dateOf, weekStart } from "../lib/time";
import type { Appointment, Result } from "../lib/types";

interface Entry { id: number; label: string; ok: boolean; text: string; code?: string }
let seq = 0;

/** Fires real calls at the data layer as whoever is signed in, so a visitor sees each rule catch (or allow) the action. */
export function RuleTester({ appts, data }: { appts: Appointment[]; data: RefData }) {
  const { adapter, actor } = useClinic();
  const [log, setLog] = useState<Entry[]>([]);
  if (!actor) return null;
  const now = adapter.now();
  const push = (label: string, r: Result<unknown>, okText: string) =>
    setLog((l) => [{ id: ++seq, label, ok: r.ok, text: r.ok ? okText : r.violations.map((v) => v.message).join(" "), code: r.ok ? undefined : r.violations.map((v) => v.code).join(", ") }, ...l].slice(0, 6));

  const firstBooked = appts.find((a) => a.status === "booked" && a.start > now);
  const patientNot = (id: string) => data.patients.find((p) => p.id !== id)?.id ?? "p-001";
  const nextSunday = addDays(weekStart(dateOf(now)), 6);
  const nextThursday = addDays(weekStart(dateOf(now)), 3);

  const tests: { label: string; run: () => Promise<void> }[] = [
    {
      label: "Book on top of an existing visit",
      run: async () => {
        if (!firstBooked) return setLog((l) => [{ id: ++seq, label: "Double booking", ok: false, text: "Open a week that has bookings first." }, ...l]);
        const r = await adapter.createAppointment(actor, { patientId: patientNot(firstBooked.patientId), dentistId: firstBooked.dentistId, chairId: firstBooked.chairId, treatmentId: "t-checkup", start: firstBooked.start });
        push("Double booking", r, "Booked (this should not happen).");
      },
    },
    {
      label: "Book on a Sunday",
      run: async () => push("Sunday booking", await adapter.createAppointment(actor, { patientId: "p-001", dentistId: "s-arben", chairId: "c1", treatmentId: "t-checkup", start: `${nextSunday}T10:00` }), "Booked (this should not happen)."),
    },
    {
      label: "Book at 07:30, before opening",
      run: async () => push("Before opening", await adapter.createAppointment(actor, { patientId: "p-001", dentistId: "s-arben", chairId: "c1", treatmentId: "t-checkup", start: `${nextThursday}T07:30` }), "Booked (this should not happen)."),
    },
    {
      label: "Cancel a visit under 24 h away, no reason",
      run: async () => {
        const soon = appts.find((a) => a.status === "booked" && a.start > now && a.start < `${addDays(dateOf(now), 1)}T${now.slice(11)}`);
        if (!soon) return setLog((l) => [{ id: ++seq, label: "Late cancellation", ok: false, text: "No visit is inside the next 24 hours in this view. Try the Day view for today." }, ...l]);
        push("Late cancellation", await adapter.cancelAppointment(actor, soon.id), "Cancelled (this should not happen).");
      },
    },
    {
      label: "Open a patient's clinical notes",
      run: async () => push("Read clinical notes", await adapter.listNotes(actor, data.patients[0]?.id ?? "p-001"), `Allowed: ${actor.name} may read this patient's notes.`),
    },
    {
      label: "Open the revenue report",
      run: async () => push("Open reports", await adapter.weekReport(actor, weekStart(dateOf(now))), `Allowed: ${actor.role}s can open reports.`),
    },
  ];

  return (
    <aside className="tester" aria-label="Try to break a rule">
      <h2>Try to break a rule</h2>
      <p className="muted small">Each button sends a real request to the data layer as <strong>{actor.name}</strong> ({actor.role}). Switch role in the header and run it again.</p>
      <div className="tests">
        {tests.map((t) => <button key={t.label} className="btn sm" onClick={() => void t.run()}>{t.label}</button>)}
      </div>
      {log.length === 0 ? <p className="muted small empty">Nothing tried yet. Start with the first button.</p> : (
        <ol className="log">
          {log.map((e) => (
            <li key={e.id} className={e.ok ? "ok" : "blocked"}>
              <div className="tag">{e.ok ? "Allowed" : <><Lock /> Blocked</>}</div> <strong>{e.label}</strong>
              <p>{e.text}</p>{e.code && <code>{e.code}</code>}
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
