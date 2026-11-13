"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { NeedsLogin } from "../../components/Shell";
import { useClinic } from "../../components/ClinicProvider";
import { RuleNotice } from "../../components/Notice";
import { useRefData } from "../../components/hooks";
import { can } from "../../lib/rules";
import { prettyDateTime } from "../../lib/time";
import type { Appointment } from "../../lib/types";

export default function PatientsPage() {
  return <NeedsLogin><Patients /></NeedsLogin>;
}

function Patients() {
  const { adapter, actor, rev, bump, say, rule, showRule, clearRule } = useClinic();
  const data = useRefData();
  const [q, setQ] = useState("");
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [form, setForm] = useState({ name: "", phone: "+355 69 ", dob: "", dentistId: "" });
  useEffect(() => {
    if (!actor) return;
    adapter.listAppointments(actor, "2026-01-01", "2027-12-31").then((r) => r.ok && setAppts(r.value));
  }, [adapter, actor, rev]);
  if (!actor) return null;
  const now = adapter.now();
  const list = data.patients.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  const dentists = data.staff.filter((s) => s.role === "dentist" && s.title === "Dentist");
  const canCreate = can(actor, "patient.create").ok;
  const nameOf = (id: string) => data.staff.find((s) => s.id === id)?.name ?? "";
  return (
    <div className="page">
      <div className="toolbar">
        <h1 className="h-sm">Patients</h1>
        <input type="search" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search patients" />
      </div>
      <p className="muted small">
        {actor.role === "dentist"
          ? `Showing the ${data.patients.length} patients you treat. Other dentists' patients are hidden from you.`
          : `${data.patients.length} patients. Clinical notes are not shown in this list.`}
      </p>
      {rule && <RuleNotice title={rule.title} violations={rule.violations} kind={rule.kind} onClose={clearRule} />}

      <details className="add" open={false}>
        <summary>Register a new patient</summary>
        <form
          className="form inline"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await adapter.createPatient(actor, { ...form, dentistId: form.dentistId || dentists[0]?.id || "" });
            if (r.ok) { setForm({ name: "", phone: "+355 69 ", dob: "", dentistId: "" }); bump(); say(`${r.value.name} registered.`); clearRule(); }
            else showRule("Patient not registered", r.violations, r.kind);
          }}
        >
          <label>Full name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Phone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label>Date of birth<input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} /></label>
          <label>Treating dentist
            <select value={form.dentistId || dentists[0]?.id} onChange={(e) => setForm({ ...form, dentistId: e.target.value })}>
              {dentists.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <button className="btn primary sm" type="submit">{canCreate ? "Register patient" : "Try to register (dentists can't)"}</button>
        </form>
      </details>

      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Patient</th><th>Phone</th><th>Treating dentist</th><th>Next visit</th><th>Last visit</th></tr></thead>
          <tbody>
            {list.map((p) => {
              const mine = appts.filter((a) => a.patientId === p.id && a.status !== "cancelled");
              const next = mine.filter((a) => a.start > now).sort((a, b) => a.start.localeCompare(b.start))[0];
              const last = mine.filter((a) => a.start <= now && a.status === "completed").sort((a, b) => b.start.localeCompare(a.start))[0];
              return (
                <tr key={p.id}>
                  <td><Link href={`/patients/view/?id=${p.id}`}>{p.name}</Link></td>
                  <td className="mono">{p.phone}</td>
                  <td>{nameOf(p.dentistId) || p.dentistId}</td>
                  <td className="mono">{next ? prettyDateTime(next.start) : <span className="muted">none booked</span>}</td>
                  <td className="mono">{last ? prettyDateTime(last.start) : <span className="muted">none yet</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 && <p className="empty">No patient matches &ldquo;{q}&rdquo;. Clear the search to see everyone you can access.</p>}
      </div>
    </div>
  );
}
