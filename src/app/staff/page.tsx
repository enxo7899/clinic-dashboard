"use client";
import { NeedsLogin } from "../../components/Shell";
import { useClinic } from "../../components/ClinicProvider";
import { LockedPanel, RuleNotice } from "../../components/Notice";
import { useRefData } from "../../components/hooks";
import { can, CLINIC_HOURS } from "../../lib/rules";
import { hhmm } from "../../lib/time";
import type { Staff } from "../../lib/types";

export default function StaffPage() {
  return <NeedsLogin><StaffScreen /></NeedsLogin>;
}

const ROLE = { admin: "Admin", receptionist: "Receptionist", dentist: "Clinical" } as const;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function hoursText(s: Staff) {
  if (!s.hours) return "";
  const parts: string[] = [];
  [1, 2, 3, 4, 5, 6].forEach((d) => {
    const w = s.hours![d];
    if (w) parts.push(`${DAYS[d]} ${hhmm(w[0])}–${hhmm(w[1])}`);
  });
  const mf = s.hours[1];
  const same = [1, 2, 3, 4, 5].every((d) => s.hours![d] && s.hours![d]![0] === mf?.[0] && s.hours![d]![1] === mf?.[1]);
  const off = [1, 2, 3, 4, 5].filter((d) => !s.hours![d]).map((d) => DAYS[d]);
  if (same && mf) return `Mon–Fri ${hhmm(mf[0])}–${hhmm(mf[1])}${s.hours[6] ? `, Sat ${hhmm(s.hours[6]![0])}–${hhmm(s.hours[6]![1])}` : ""}`;
  return parts.join(", ") + (off.length ? ` (off ${off.join(", ")})` : "");
}

function StaffScreen() {
  const { adapter, actor, bump, say, rule, showRule, clearRule } = useClinic();
  const data = useRefData();
  if (!actor || !data.loaded) return <p className="muted pad">Loading…</p>;
  if (!can(actor, "staff.manage").ok)
    return <div className="page narrow"><h1>Staff</h1><LockedPanel title="Staff management is for the clinic admin" message={(can(actor, "staff.manage") as { message: string }).message} /></div>;
  return (
    <div className="page">
      <h1 className="h-sm">Staff</h1>
      <p className="muted small">Clinic hours: Mon–Fri {hhmm(CLINIC_HOURS[1]![0])}–{hhmm(CLINIC_HOURS[1]![1])}, Sat {hhmm(CLINIC_HOURS[6]![0])}–{hhmm(CLINIC_HOURS[6]![1])}. Each person works inside those hours.</p>
      {rule && <RuleNotice title={rule.title} violations={rule.violations} kind={rule.kind} onClose={clearRule} />}
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Role</th><th>Title</th><th>Working hours</th><th>Access</th></tr></thead>
          <tbody>
            {data.staff.map((s) => (
              <tr key={s.id} className={s.active ? "" : "inactive"}>
                <td><strong>{s.name}</strong><div className="muted small mono">{s.email}</div></td>
                <td>{ROLE[s.role]}</td>
                <td>{s.title}</td>
                <td className="small">{hoursText(s) || <span className="muted">Front desk</span>}</td>
                <td>
                  <button className="btn sm" onClick={async () => {
                    const r = await adapter.setStaffActive(actor, s.id, !s.active);
                    if (r.ok) { clearRule(); bump(); say(`${s.name} ${r.value.active ? "reactivated" : "deactivated"}.`); }
                    else showRule(`Can't deactivate ${s.name}`, r.violations, r.kind);
                  }}>{s.active ? "Deactivate" : "Reactivate"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Try deactivating Dr. Hoxha or yourself: the rule stops it. Deactivate a receptionist to see them leave the booking lists.</p>
    </div>
  );
}
