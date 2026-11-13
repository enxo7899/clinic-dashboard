import { test } from "node:test";
import assert from "node:assert/strict";
import { computeWeekReport } from "../src/lib/reports";
import { buildSeed, DEMO_WEEK_START } from "../src/lib/seed";
import { seedSql } from "../scripts/make-seed-sql";
import { readFileSync } from "node:fs";
import type { Appointment, Staff, Treatment } from "../src/lib/types";

const s = buildSeed();
const dentist: Staff = { id: "d1", name: "D", role: "dentist", title: "Dentist", email: "d@x", active: true, hours: [null, [540, 1080], null, null, null, null, null] };
const tr: Treatment[] = [{ id: "t", name: "T", minutes: 60, priceAll: 1000, by: "Dentist" }];
const a = (id: string, status: Appointment["status"], start: string, end: string): Appointment => ({ id, patientId: "p", dentistId: "d1", chairId: "c1", treatmentId: "t", start, end, status, createdBy: "x" });

test("utilisation is booked minutes divided by working minutes, ignoring cancellations", () => {
  const r = computeWeekReport("2026-11-09", [dentist], tr, [
    a("1", "completed", "2026-11-09T09:00", "2026-11-09T10:00"),
    a("2", "booked", "2026-11-09T10:00", "2026-11-09T12:00"),
    a("3", "cancelled", "2026-11-09T12:00", "2026-11-09T18:00"),
  ]);
  assert.equal(r.rows[0].availableMinutes, 540);
  assert.equal(r.rows[0].bookedMinutes, 180);
  assert.equal(r.rows[0].utilisation, 180 / 540);
});

test("revenue counts completed visits only and no-shows are counted separately", () => {
  const r = computeWeekReport("2026-11-09", [dentist], tr, [
    a("1", "completed", "2026-11-09T09:00", "2026-11-09T10:00"),
    a("2", "no_show", "2026-11-09T10:00", "2026-11-09T11:00"),
    a("3", "booked", "2026-11-09T11:00", "2026-11-09T12:00"),
  ]);
  assert.equal(r.revenueCompletedAll, 1000);
  assert.equal(r.revenueStillToComeAll, 1000);
  assert.equal(r.noShows, 1);
  assert.equal(r.noShowRate, 0.5);
});

test("seeded week report adds up: per-dentist revenue equals the total", () => {
  const r = computeWeekReport(DEMO_WEEK_START, s.staff, s.treatments, s.appointments);
  assert.equal(r.rows.reduce((x, y) => x + y.revenueAll, 0), r.revenueCompletedAll);
  assert.equal(r.byTreatment.reduce((x, y) => x + y.revenueAll, 0), r.revenueCompletedAll);
  assert.ok(r.rows.every((x) => x.utilisation >= 0 && x.utilisation <= 1));
});

test("supabase/seed.sql is in sync with the demo seed", () => {
  const onDisk = readFileSync(new URL("../supabase/seed.sql", import.meta.url), "utf8");
  assert.equal(onDisk, seedSql());
});
