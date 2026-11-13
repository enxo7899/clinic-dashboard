"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NeedsLogin } from "../../components/Shell";
import { useClinic } from "../../components/ClinicProvider";
import { Drawer, type DrawerTarget } from "../../components/Drawer";
import { RuleNotice } from "../../components/Notice";
import { RuleTester } from "../../components/RuleTester";
import { useRefData } from "../../components/hooks";
import { workingWindow } from "../../lib/rules";
import { addDays, dateOf, fromMinutes, minuteOfDay, prettyDate, timeOf, toMinutes, weekStart } from "../../lib/time";
import type { Appointment, Staff } from "../../lib/types";

const START = 9 * 60, END = 18 * 60, PX = 1.2;
const HOURS = Array.from({ length: 9 }, (_, i) => 9 + i);
const SHORT: Record<string, string> = { "t-checkup": "Check-up", "t-clean": "Scale and polish", "t-filling": "Filling", "t-extract": "Extraction", "t-root": "Root canal", "t-crown": "Crown", "t-whiten": "Whitening", "t-ortho": "Braces review", "t-pain": "Pain visit" };

export default function CalendarPage() {
  return (
    <NeedsLogin>
      <Calendar />
    </NeedsLogin>
  );
}

function Calendar() {
  const { adapter, actor, rev, bump, say, rule, showRule, clearRule, toast } = useClinic();
  const data = useRefData();
  const [date, setDate] = useState(dateOf(adapter.now()));
  const [view, setView] = useState<"day" | "week">("day");
  const [weekProvider, setWeekProvider] = useState("");
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [tester, setTester] = useState(false);
  const [hint, setHint] = useState<{ key: string; minute: number } | null>(null);
  const drag = useRef<{ id: string; grab: number } | null>(null);

  // URL parameters make screenshots and shared links reproducible.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("date")) setDate(q.get("date")!);
    if (q.get("view") === "week") setView("week");
    if (q.get("prov")) setWeekProvider(q.get("prov")!);
    setTester(q.has("tester") || window.innerWidth >= 1200);
  }, []);

  const rangeFrom = view === "day" ? date : weekStart(date);
  const rangeTo = view === "day" ? date : addDays(weekStart(date), 5);
  useEffect(() => {
    if (!actor) return;
    let live = true;
    adapter.listAppointments(actor, rangeFrom, rangeTo).then((r) => live && r.ok && setAppts(r.value));
    return () => { live = false; };
  }, [adapter, actor, rangeFrom, rangeTo, rev]);

  const providers = data.providers;
  const wp = weekProvider && providers.some((p) => p.id === weekProvider) ? weekProvider : providers[0]?.id ?? "";
  const patientName = (id: string) => data.patients.find((p) => p.id === id)?.name ?? "Patient";

  // open a drawer from URL once data is in
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !data.loaded || !appts.length) return;
    const q = new URLSearchParams(window.location.search);
    const id = q.get("appt");
    if (id) { const a = appts.find((x) => x.id === id); if (a) { setDrawer({ kind: "edit", appt: a }); opened.current = true; } }
    if (q.get("new")) { setDrawer({ kind: "new", start: q.get("new")!, dentistId: q.get("prov") || providers[0]?.id || "", patientId: q.get("patient") || undefined }); opened.current = true; }
  }, [data.loaded, appts, providers]);

  const cols: { key: string; label: string; sub: string; date: string; provider: Staff | undefined }[] = useMemo(() => {
    if (view === "day") return providers.map((p) => ({ key: p.id, label: p.name, sub: p.title, date, provider: p }));
    const p = providers.find((x) => x.id === wp);
    return Array.from({ length: 6 }, (_, i) => addDays(weekStart(date), i)).map((d) => ({ key: d, label: prettyDate(d), sub: p?.name ?? "", date: d, provider: p }));
  }, [view, providers, date, wp]);

  const minuteAt = (e: { clientY: number }, el: HTMLElement, grab = 0) => {
    const y = e.clientY - el.getBoundingClientRect().top;
    const m = START + Math.round((y / PX - grab) / 15) * 15;
    return Math.max(START, Math.min(END - 15, m));
  };
  const startFor = (col: (typeof cols)[number], minute: number) => `${col.date}T${fromMinutes(minute).slice(11)}`;

  const create = (col: (typeof cols)[number], minute: number) => {
    setDrawer({ kind: "new", start: startFor(col, minute), dentistId: col.provider?.id ?? providers[0]?.id ?? "" });
  };

  const move = useCallback(async (id: string, col: (typeof cols)[number], minute: number) => {
    const a = appts.find((x) => x.id === id);
    if (!a || !actor) return;
    const newProv = col.provider?.id ?? a.dentistId;
    const change = { start: startFor(col, minute), dentistId: newProv, chairId: newProv === a.dentistId ? a.chairId : data.staff.find((s) => s.id === newProv)?.defaultChair ?? a.chairId };
    const r = await adapter.moveAppointment(actor, id, change);
    if (r.ok) { clearRule(); say(`Moved to ${timeOf(r.value.start)}.`); bump(); }
    else showRule(`Couldn't move ${patientName(a.patientId)}`, r.violations, r.kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appts, actor, adapter, data]);

  if (!actor) return null;
  const now = adapter.now();
  const nowLine = cols.some((c) => c.date === dateOf(now)) ? (toMinutes(now) - toMinutes(`${dateOf(now)}T00:00`)) : null;

  return (
    <div className={`cal-page ${tester ? "with-tester" : ""}`}>
      <div className="cal-main">
        <div className="toolbar">
          <h1 className="h-sm">{view === "day" ? prettyDate(date) : `Week of ${prettyDate(weekStart(date))}`}</h1>
          <div className="seg" role="group" aria-label="Move">
            <button onClick={() => setDate(addDays(date, view === "day" ? -1 : -7))} aria-label="Previous">‹</button>
            <button onClick={() => setDate(dateOf(now))}>Today</button>
            <button onClick={() => setDate(addDays(date, view === "day" ? 1 : 7))} aria-label="Next">›</button>
          </div>
          <div className="seg" role="group" aria-label="View">
            <button className={view === "day" ? "on" : ""} onClick={() => setView("day")}>Day</button>
            <button className={view === "week" ? "on" : ""} onClick={() => setView("week")}>Week</button>
          </div>
          {view === "week" && providers.length > 1 && (
            <select aria-label="Provider" value={wp} onChange={(e) => setWeekProvider(e.target.value)}>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button className="btn ghost sm" onClick={() => setTester((t) => !t)} aria-expanded={tester}>Try to break a rule</button>
        </div>

        <p className="hint small muted">
          {actor.role === "dentist"
            ? "You see only your own schedule. Click a visit to open it and record the outcome or write a note."
            : "Click an empty slot to book. Drag a visit to another time or dentist to move it. Hatched areas are outside working hours."}
        </p>

        {rule && <RuleNotice title={rule.title} violations={rule.violations} kind={rule.kind} onClose={clearRule} />}

        <div className="grid-wrap">
          <div className="grid" style={{ ["--cols" as string]: cols.length }}>
            <div className="g-head g-corner" />
            {cols.map((c) => (
              <div className="g-head" key={c.key}><strong>{c.label}</strong><span>{c.sub}</span></div>
            ))}
            <div className="g-times" style={{ height: (END - START) * PX }}>
              {HOURS.map((h) => <span key={h} className="mono" style={{ top: (h * 60 - START) * PX }}>{String(h).padStart(2, "0")}:00</span>)}
            </div>
            {cols.map((c) => {
              const win = c.provider ? workingWindow(c.provider, c.date) : null;
              const list = appts.filter((a) => a.status !== "cancelled" && (view === "day" ? a.dentistId === c.key : a.dentistId === wp && dateOf(a.start) === c.date));
              return (
                <div
                  key={c.key}
                  className="g-col"
                  style={{ height: (END - START) * PX }}
                  onClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("off")) create(c, minuteAt(e, e.currentTarget)); }}
                  onDragOver={(e) => { if (!drag.current) return; e.preventDefault(); setHint({ key: c.key, minute: minuteAt(e, e.currentTarget, drag.current.grab) }); }}
                  onDragLeave={(e) => { if (e.currentTarget === e.target) setHint(null); }}
                  onDrop={(e) => { e.preventDefault(); const d = drag.current; drag.current = null; setHint(null); if (d) void move(d.id, c, minuteAt(e, e.currentTarget, d.grab)); }}
                >
                  {!win ? <div className="off" style={{ top: 0, bottom: 0 }} /> : (
                    <>
                      {win[0] > START && <div className="off" style={{ top: 0, height: (win[0] - START) * PX }} />}
                      {win[1] < END && <div className="off" style={{ top: (win[1] - START) * PX, bottom: 0 }} />}
                    </>
                  )}
                  {HOURS.slice(1).map((h) => <div key={h} className="hline" style={{ top: (h * 60 - START) * PX }} />)}
                  {nowLine !== null && c.date === dateOf(now) && <div className="nowline" style={{ top: (nowLine - START) * PX }} title={`Demo clock ${timeOf(now)}`} />}
                  {list.map((a) => {
                    const dur = toMinutes(a.end) - toMinutes(a.start);
                    return (
                      <button
                        key={a.id}
                        className={`blk s-${a.status}`}
                        style={{ top: (minuteOfDay(a.start) - START) * PX, height: Math.max(dur * PX - 2, 20) }}
                        draggable
                        onDragStart={(e) => { e.dataTransfer.setData("text/plain", a.id); e.dataTransfer.effectAllowed = "move"; drag.current = { id: a.id, grab: Math.round((e.clientY - e.currentTarget.getBoundingClientRect().top) / PX) }; }}
                        onDragEnd={() => { drag.current = null; setHint(null); }}
                        onClick={(e) => { e.stopPropagation(); setDrawer({ kind: "edit", appt: a }); }}
                        title={`${timeOf(a.start)}–${timeOf(a.end)} ${patientName(a.patientId)}`}
                      >
                        <span className="mono">{timeOf(a.start)}</span>
                        <strong>{patientName(a.patientId)}</strong>
                        {dur >= 40 && <em>{SHORT[a.treatmentId]}</em>}
                      </button>
                    );
                  })}
                  {hint?.key === c.key && <div className="drop" style={{ top: (hint.minute - START) * PX }}><span className="mono">{fromMinutes(hint.minute).slice(11)}</span></div>}
                </div>
              );
            })}
          </div>
        </div>
        <p className="legend small muted">
          <i className="sw s-booked" /> booked <i className="sw s-completed" /> completed <i className="sw s-no_show" /> no-show. Cancelled visits are hidden and free their slot.
        </p>
      </div>

      {tester && <RuleTester appts={appts} data={data} />}
      {drawer && <Drawer key={drawer.kind === "edit" ? drawer.appt.id + drawer.appt.start : drawer.start + drawer.dentistId} target={drawer} data={data} onClose={() => setDrawer(null)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
