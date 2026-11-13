"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useClinic } from "./ClinicProvider";
import { NotesPanel } from "./NotesPanel";
import { RuleNotice } from "./Notice";
import type { RefData } from "./hooks";
import { aed } from "./hooks";
import { checkAppointment, isLateCancellation, can } from "../lib/rules";
import { addMinutes, dateOf, hhmm, prettyDate, timeOf } from "../lib/time";
import type { Appointment, Violation } from "../lib/types";

export type DrawerTarget =
  | { kind: "new"; start: string; dentistId: string; patientId?: string }
  | { kind: "edit"; appt: Appointment };

const TIMES = Array.from({ length: 52 }, (_, i) => hhmm(7 * 60 + i * 15));
const STATUS_LABEL = { booked: "Booked", completed: "Completed", no_show: "No-show", cancelled: "Cancelled" } as const;

export function Drawer({ target, data, onClose }: { target: DrawerTarget; data: RefData; onClose: () => void }) {
  const { adapter, actor, bump, say } = useClinic();
  const isNew = target.kind === "new";
  const base = isNew
    ? { patientId: target.patientId ?? "", treatmentId: "t-checkup", dentistId: target.dentistId, chairId: data.providers.find((p) => p.id === target.dentistId)?.defaultChair ?? "c1", start: target.start }
    : { patientId: target.appt.patientId, treatmentId: target.appt.treatmentId, dentistId: target.appt.dentistId, chairId: target.appt.chairId, start: target.appt.start };
  const [f, setF] = useState(base);
  const [dayAppts, setDayAppts] = useState<Appointment[]>([]);
  const [err, setErr] = useState<{ title: string; v: Violation[]; kind: string } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const date = dateOf(f.start);
  const treatment = data.treatments.find((t) => t.id === f.treatmentId);
  const provider = data.staff.find((s) => s.id === f.dentistId) ?? data.providers.find((s) => s.id === f.dentistId);

  useEffect(() => {
    if (!actor) return;
    let live = true;
    adapter.listAppointments(actor, date, date).then((r) => live && r.ok && setDayAppts(r.value));
    return () => { live = false; };
  }, [adapter, actor, date]);

  const live = useMemo(
    () => checkAppointment({ ...f }, { provider, treatment, existing: dayAppts, now: adapter.now(), ignoreId: isNew ? undefined : target.appt.id }),
    [f, provider, treatment, dayAppts, adapter, isNew, target],
  );
  const set = (patch: Partial<typeof f>) => { setErr(null); setF((x) => ({ ...x, ...patch })); };
  const frozen = !isNew && target.appt.status !== "booked";
  const patient = data.patients.find((p) => p.id === f.patientId);
  if (!actor) return null;

  async function save() {
    const r = isNew
      ? await adapter.createAppointment(actor!, f)
      : await adapter.moveAppointment(actor!, target.kind === "edit" ? target.appt.id : "", { dentistId: f.dentistId, chairId: f.chairId, treatmentId: f.treatmentId, start: f.start });
    if (r.ok) { bump(); say(isNew ? "Appointment booked." : "Appointment updated."); onClose(); }
    else setErr({ title: isNew ? "Booking refused" : "Change refused", v: r.violations, kind: r.kind });
  }
  async function cancel() {
    if (target.kind !== "edit") return;
    const r = await adapter.cancelAppointment(actor!, target.appt.id, reason);
    if (r.ok) { bump(); say("Appointment cancelled."); onClose(); }
    else setErr({ title: "Cancellation refused", v: r.violations, kind: r.kind });
  }
  async function outcome(s: "completed" | "no_show") {
    if (target.kind !== "edit") return;
    const r = await adapter.setOutcome(actor!, target.appt.id, s);
    if (r.ok) { bump(); say(s === "completed" ? "Marked completed." : "Marked no-show."); onClose(); }
    else setErr({ title: "Outcome refused", v: r.violations, kind: r.kind });
  }

  const late = !isNew && isLateCancellation(target.appt.start, adapter.now());
  const canEdit = can(actor, "appointment.move").ok;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={isNew ? "New appointment" : "Appointment"}>
        <div className="drawer-head">
          <div>
            <p className="eyebrow">{isNew ? "New appointment" : `Appointment ${target.appt.id}`}</p>
            <h2>{isNew ? "Book a visit" : patient?.name ?? "Appointment"}</h2>
          </div>
          <button className="btn ghost sm" onClick={onClose}>Close</button>
        </div>

        {!isNew && <p><span className={`chip s-${target.appt.status}`}>{STATUS_LABEL[target.appt.status]}</span>{target.appt.cancelReason && <span className="muted"> · {target.appt.cancelReason}</span>}</p>}
        {!canEdit && <p className="muted small">As a {actor.role} you can view this and record outcomes. Changes go through reception.</p>}

        <div className="form">
          <label>Patient
            <select value={f.patientId} disabled={!isNew} onChange={(e) => set({ patientId: e.target.value })}>
              <option value="">Choose a patient…</option>
              {data.patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>Treatment
            <select value={f.treatmentId} disabled={frozen} onChange={(e) => set({ treatmentId: e.target.value })}>
              {data.treatments.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.minutes} min · {aed(t.priceAll)}</option>)}
            </select>
          </label>
          <div className="row2">
            <label>Provider
              <select value={f.dentistId} disabled={frozen} onChange={(e) => {
                const p = data.staff.find((s) => s.id === e.target.value);
                set({ dentistId: e.target.value, chairId: p?.defaultChair ?? f.chairId });
              }}>
                {data.staff.filter((s) => s.role === "dentist" && s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label>Chair
              <select value={f.chairId} disabled={frozen} onChange={(e) => set({ chairId: e.target.value })}>
                {data.chairs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>
          <div className="row2">
            <label>Date
              <input type="date" value={date} disabled={frozen} onChange={(e) => e.target.value && set({ start: `${e.target.value}T${timeOf(f.start)}` })} />
            </label>
            <label>Start
              <select value={timeOf(f.start)} disabled={frozen} onChange={(e) => set({ start: `${date}T${e.target.value}` })}>
                {TIMES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
          </div>
          {treatment && <p className="muted small">{prettyDate(date)}, <span className="mono">{timeOf(f.start)}–{timeOf(addMinutes(f.start, treatment.minutes))}</span> ({treatment.minutes} min)</p>}
        </div>

        {!frozen && (
          <div className={`live ${live.length ? "bad" : "good"}`} aria-live="polite">
            {live.length === 0 ? "This slot passes every scheduling rule." : <ul>{live.map((v, i) => <li key={i}>{v.message}</li>)}</ul>}
            <span className="muted small">Checked as you type. The data layer checks again on save.</span>
          </div>
        )}
        {err && <RuleNotice title={err.title} violations={err.v} kind={err.kind} onClose={() => setErr(null)} />}

        {!frozen && (
          <div className="actions">
            <button className="btn primary" onClick={save}>{isNew ? "Book appointment" : "Save changes"}</button>
          </div>
        )}

        {!isNew && target.appt.status === "booked" && (
          <div className="stack">
            <div className="actions">
              <button className="btn" onClick={() => void outcome("completed")}>Mark completed</button>
              <button className="btn" onClick={() => void outcome("no_show")}>Mark no-show</button>
              <button className="btn danger" onClick={() => setCancelling((c) => !c)}>Cancel appointment…</button>
            </div>
            {cancelling && (
              <div className="form">
                <label>Reason {late ? <b className="req">(required: starts in under 24 hours)</b> : <span className="muted">(optional: more than 24 hours away)</span>}
                  <textarea rows={2} value={reason} onChange={(e) => { setReason(e.target.value); setErr(null); }} placeholder="e.g. Patient called, has a fever" />
                </label>
                <button className="btn danger" onClick={() => void cancel()}>Confirm cancellation</button>
              </div>
            )}
          </div>
        )}

        {!isNew && patient && (
          <div className="stack">
            <p><Link href={`/patients/view/?id=${patient.id}`}>Open patient page</Link></p>
            <NotesPanel patientId={patient.id} staff={data.staff} />
          </div>
        )}
      </aside>
    </>
  );
}
