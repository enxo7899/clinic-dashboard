"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { NeedsLogin } from "../../../components/Shell";
import { useClinic } from "../../../components/ClinicProvider";
import { LockedPanel } from "../../../components/Notice";
import { NotesPanel } from "../../../components/NotesPanel";
import { aed, useRefData } from "../../../components/hooks";
import { can } from "../../../lib/rules";
import { prettyDateTime } from "../../../lib/time";
import type { Appointment, Patient, Violation } from "../../../lib/types";

export default function PatientPage() {
  return <NeedsLogin><View /></NeedsLogin>;
}

const STATUS = { booked: "Booked", completed: "Completed", no_show: "No-show", cancelled: "Cancelled" } as const;

function View() {
  const { adapter, actor, rev, ready } = useClinic();
  const data = useRefData();
  const [id, setId] = useState<string | null>(null);
  const [state, setState] = useState<{ patient?: Patient; appts: Appointment[]; denied?: Violation[] } | null>(null);
  useEffect(() => { setId(new URLSearchParams(window.location.search).get("id") ?? ""); }, []);
  useEffect(() => {
    if (!actor || id === null) return;
    let live = true;
    adapter.getPatient(actor, id).then((r) => {
      if (!live) return;
      setState(r.ok ? { patient: r.value.patient, appts: r.value.appointments } : { appts: [], denied: r.violations });
    });
    return () => { live = false; };
  }, [adapter, actor, id, rev]);
  if (!actor || !ready || !state) return <p className="muted pad">Loading…</p>;
  if (state.denied)
    return (
      <div className="page narrow">
        <p><Link href="/patients/">‹ Patients</Link></p>
        <LockedPanel title="This patient is closed to you" message={state.denied[0].message} />
      </div>
    );
  const p = state.patient!;
  const dentist = data.staff.find((s) => s.id === p.dentistId)?.name ?? p.dentistId;
  const tr = (tid: string) => data.treatments.find((t) => t.id === tid);
  const sorted = [...state.appts].sort((a, b) => b.start.localeCompare(a.start));
  const now = adapter.now();
  return (
    <div className="page patient">
      <p><Link href="/patients/">‹ Patients</Link></p>
      <header className="p-head">
        <div>
          <h1>{p.name}</h1>
          <dl className="facts">
            <div><dt>Phone</dt><dd className="mono">{p.phone}</dd></div>
            <div><dt>Born</dt><dd className="mono">{p.dob}</dd></div>
            <div><dt>Treating dentist</dt><dd>{dentist}</dd></div>
            <div><dt>Record</dt><dd className="mono">{p.id}</dd></div>
          </dl>
        </div>
        {can(actor, "appointment.create").ok && (
          <Link className="btn primary" href={`/calendar/?new=${now.slice(0, 10)}T10:00&patient=${p.id}&date=${now.slice(0, 10)}`}>Book a visit</Link>
        )}
      </header>

      <div className="p-cols">
        <section>
          <h3>Visits</h3>
          {actor.role === "dentist" && <p className="muted small">You see only the visits you took part in.</p>}
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>When</th><th>Treatment</th><th>Dentist</th><th>Status</th><th className="num">Price</th></tr></thead>
              <tbody>
                {sorted.map((a) => (
                  <tr key={a.id} className={a.start > now && a.status === "booked" ? "upcoming" : ""}>
                    <td className="mono">{prettyDateTime(a.start)}</td>
                    <td>{tr(a.treatmentId)?.name}</td>
                    <td>{data.staff.find((s) => s.id === a.dentistId)?.name ?? ""}</td>
                    <td><span className={`chip s-${a.status}`}>{STATUS[a.status]}</span>{a.cancelReason && <div className="muted small">{a.cancelReason}</div>}</td>
                    <td className="num mono">{tr(a.treatmentId) ? aed(tr(a.treatmentId)!.priceAll) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sorted.length === 0 && <p className="empty">No visits yet. Use &ldquo;Book a visit&rdquo; to add the first one.</p>}
          </div>
        </section>
        <section>
          <NotesPanel patientId={p.id} staff={data.staff} />
        </section>
      </div>
    </div>
  );
}
