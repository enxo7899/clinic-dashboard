"use client";
import { useEffect, useState } from "react";
import { NeedsLogin } from "../../components/Shell";
import { useClinic } from "../../components/ClinicProvider";
import { LockedPanel } from "../../components/Notice";
import { aed } from "../../components/hooks";
import type { WeekReport } from "../../lib/adapter";
import { addDays, prettyDate, weekStart, dateOf } from "../../lib/time";
import type { Violation } from "../../lib/types";

export default function ReportsPage() {
  return <NeedsLogin><Reports /></NeedsLogin>;
}

function Reports() {
  const { adapter, actor, rev } = useClinic();
  const [ws, setWs] = useState(weekStart(dateOf(adapter.now())));
  const [rep, setRep] = useState<WeekReport | null>(null);
  const [denied, setDenied] = useState<Violation[] | null>(null);
  useEffect(() => {
    if (!actor) return;
    let live = true;
    adapter.weekReport(actor, ws).then((r) => {
      if (!live) return;
      if (r.ok) { setRep(r.value); setDenied(null); } else { setRep(null); setDenied(r.violations); }
    });
    return () => { live = false; };
  }, [adapter, actor, ws, rev]);
  if (denied) return <div className="page narrow"><h1>Reports</h1><LockedPanel title="Reports are for the clinic admin" message={denied[0].message} /></div>;
  if (!rep) return <p className="muted pad">Loading…</p>;
  const hrs = (m: number) => `${(m / 60).toFixed(1)} h`;
  const attended = rep.rows.reduce((s, r) => s + r.completed, 0) + rep.noShows;
  return (
    <div className="page">
      <div className="toolbar">
        <h1 className="h-sm">Week of {prettyDate(ws)}</h1>
        <div className="seg">
          <button onClick={() => setWs(addDays(ws, -7))} aria-label="Previous week">‹</button>
          <button onClick={() => setWs(weekStart(dateOf(adapter.now())))}>This week</button>
          <button onClick={() => setWs(addDays(ws, 7))} aria-label="Next week">›</button>
        </div>
      </div>

      <p className="summary">
        <span><b className="mono">{aed(rep.revenueCompletedAll)}</b> earned from completed visits</span>
        <span><b className="mono">{aed(rep.revenueStillToComeAll)}</b> still booked to come</span>
        <span><b className="mono">{rep.noShows}</b> no-show{rep.noShows === 1 ? "" : "s"} out of {attended} finished visits ({(rep.noShowRate * 100).toFixed(1)}%)</span>
      </p>

      <h2>Chair time used, by dentist</h2>
      <p className="muted small">Booked minutes (cancellations excluded) over each person&apos;s working minutes this week.</p>
      <div className="table-wrap">
        <table className="tbl util">
          <thead><tr><th>Dentist</th><th>Utilisation</th><th className="num">Booked / available</th><th className="num">Visits</th><th className="num">No-shows</th><th className="num">Revenue</th></tr></thead>
          <tbody>
            {rep.rows.map((r) => (
              <tr key={r.dentistId}>
                <td><strong>{r.name}</strong><div className="muted small">{r.title}</div></td>
                <td>
                  <div className="bar" role="img" aria-label={`${Math.round(r.utilisation * 100)} percent`}><i style={{ width: `${Math.min(100, r.utilisation * 100)}%` }} /></div>
                  <span className="mono">{(r.utilisation * 100).toFixed(0)}%</span>
                </td>
                <td className="num mono">{hrs(r.bookedMinutes)} / {hrs(r.availableMinutes)}</td>
                <td className="num mono">{r.appointments}</td>
                <td className="num mono">{r.noShows}</td>
                <td className="num mono">{aed(r.revenueAll)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Revenue by treatment</h2>
      <div className="table-wrap narrow-tbl">
        <table className="tbl">
          <thead><tr><th>Treatment</th><th className="num">Done</th><th className="num">Revenue</th></tr></thead>
          <tbody>
            {rep.byTreatment.map((t) => <tr key={t.treatmentId}><td>{t.name}</td><td className="num mono">{t.count}</td><td className="num mono">{aed(t.revenueAll)}</td></tr>)}
            {rep.byTreatment.length === 0 && <tr><td colSpan={3} className="empty">No completed visits in this week. The seeded data covers the week of {prettyDate("2026-11-09")}.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted small">Every figure is computed from the appointment records by <code>src/lib/reports.ts</code>. Revenue counts completed visits at list price.</p>
    </div>
  );
}
