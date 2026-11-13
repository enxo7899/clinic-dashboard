// Report maths, pure: the admin screen and the tests both call this.
import { workingWindow } from "./rules";
import { addDays, dateOf, toMinutes } from "./time";
import type { Appointment, Staff, Treatment } from "./types";
import type { WeekReport } from "./adapter";

export function computeWeekReport(
  weekStart: string,
  staff: Staff[],
  treatments: Treatment[],
  appts: Appointment[],
): WeekReport {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const inWeek = appts.filter((a) => days.includes(dateOf(a.start)));
  const price = (id: string) => treatments.find((t) => t.id === id)?.priceAll ?? 0;
  const rows = staff
    .filter((s) => s.role === "dentist")
    .map((s) => {
      const mine = inWeek.filter((a) => a.dentistId === s.id);
      const live = mine.filter((a) => a.status !== "cancelled");
      const availableMinutes = days.reduce((sum, d) => {
        const w = workingWindow(s, d);
        return sum + (w ? w[1] - w[0] : 0);
      }, 0);
      const bookedMinutes = live.reduce((sum, a) => sum + (toMinutes(a.end) - toMinutes(a.start)), 0);
      const done = mine.filter((a) => a.status === "completed");
      return {
        dentistId: s.id,
        name: s.name,
        title: s.title,
        bookedMinutes,
        availableMinutes,
        utilisation: availableMinutes ? bookedMinutes / availableMinutes : 0,
        appointments: live.length,
        noShows: mine.filter((a) => a.status === "no_show").length,
        completed: done.length,
        revenueAll: done.reduce((sum, a) => sum + price(a.treatmentId), 0),
      };
    });
  const noShows = rows.reduce((s, r) => s + r.noShows, 0);
  const attendedOrMissed = inWeek.filter((a) => a.status === "completed" || a.status === "no_show").length;
  const byT = new Map<string, { count: number; revenueAll: number }>();
  for (const a of inWeek.filter((x) => x.status === "completed")) {
    const cur = byT.get(a.treatmentId) ?? { count: 0, revenueAll: 0 };
    byT.set(a.treatmentId, { count: cur.count + 1, revenueAll: cur.revenueAll + price(a.treatmentId) });
  }
  return {
    weekStart,
    rows,
    noShows,
    noShowRate: attendedOrMissed ? noShows / attendedOrMissed : 0,
    revenueCompletedAll: rows.reduce((s, r) => s + r.revenueAll, 0),
    revenueStillToComeAll: inWeek.filter((a) => a.status === "booked").reduce((s, a) => s + price(a.treatmentId), 0),
    byTreatment: [...byT.entries()]
      .map(([treatmentId, v]) => ({ treatmentId, name: treatments.find((t) => t.id === treatmentId)?.name ?? treatmentId, ...v }))
      .sort((a, b) => b.revenueAll - a.revenueAll),
  };
}
