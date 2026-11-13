import { test } from "node:test";
import assert from "node:assert/strict";
import {
  can, canReadNotes, canWriteNotes, checkAppointment, checkCancellation, isLateCancellation, isOwnPatient, workingWindow,
} from "../src/lib/rules";
import { buildSeed, DEMO_NOW, STAFF, TREATMENTS } from "../src/lib/seed";
import type { Appointment, AppointmentInput } from "../src/lib/types";

const staff = (id: string) => STAFF.find((s) => s.id === id)!;
const treat = (id: string) => TREATMENTS.find((t) => t.id === id)!;
const gerta = staff("s-gerta"), elira = staff("s-elira"), arben = staff("s-arben"), ilir = staff("s-ilir"), mirela = staff("s-mirela");
const seed = buildSeed();
const NOW = DEMO_NOW; // Wed 11 Nov 2026 09:40

function appt(over: Partial<Appointment>): Appointment {
  return { id: "a-x", patientId: "p-001", dentistId: "s-arben", chairId: "c1", treatmentId: "t-checkup", start: "2026-11-12T10:00", end: "2026-11-12T10:30", status: "booked", createdBy: "s-gerta", ...over };
}
function check(over: Partial<AppointmentInput>, existing: Appointment[] = [], ignoreId?: string) {
  const input: AppointmentInput = { patientId: "p-002", dentistId: "s-arben", chairId: "c1", treatmentId: "t-checkup", start: "2026-11-12T10:00", ...over };
  return checkAppointment(input, { provider: staff(input.dentistId), treatment: treat(input.treatmentId), existing, now: NOW, ignoreId }).map((v) => v.code);
}

test("receptionists can create, move and cancel appointments", () => {
  for (const a of ["appointment.create", "appointment.move", "appointment.cancel"] as const) assert.equal(can(gerta, a).ok, true);
});

test("dentists cannot create, move or cancel appointments", () => {
  for (const a of ["appointment.create", "appointment.move", "appointment.cancel"] as const) assert.equal(can(elira, a).ok, false);
});

test("receptionists and admins can never read clinical notes", () => {
  const p = seed.patients[0];
  assert.equal(canReadNotes(gerta, p, seed.appointments).ok, false);
  assert.equal(canReadNotes(ilir, p, seed.appointments).ok, false);
  const d = can(gerta, "notes.read");
  assert.equal(d.ok, false);
  if (!d.ok) assert.match(d.message, /Receptionists can't open clinical notes/);
});

test("a dentist can read and write notes only for their own patients", () => {
  const mine = seed.patients.find((p) => p.dentistId === "s-elira")!;
  const other = seed.patients.find((p) => p.dentistId !== "s-elira" && !seed.appointments.some((a) => a.patientId === p.id && a.dentistId === "s-elira"))!;
  assert.equal(canReadNotes(elira, mine, seed.appointments).ok, true);
  assert.equal(canWriteNotes(elira, mine, seed.appointments).ok, true);
  assert.equal(canReadNotes(elira, other, seed.appointments).ok, false);
  assert.equal(canWriteNotes(elira, other, seed.appointments).ok, false);
});

test("a dentist who has treated a patient shares care of them, a cancelled booking does not count", () => {
  const p = seed.patients.find((x) => x.dentistId === "s-arben")!;
  assert.equal(isOwnPatient(elira, p, [appt({ patientId: p.id, dentistId: "s-elira" })]), true);
  assert.equal(isOwnPatient(elira, p, [appt({ patientId: p.id, dentistId: "s-elira", status: "cancelled" })]), false);
});

test("only the admin can open reports and manage staff", () => {
  assert.equal(can(ilir, "report.view").ok, true);
  assert.equal(can(ilir, "staff.manage").ok, true);
  assert.equal(can(gerta, "report.view").ok, false);
  assert.equal(can(elira, "staff.manage").ok, false);
});

test("a free slot inside working hours is accepted", () => {
  assert.deepEqual(check({}), []);
});

test("two appointments for the same dentist cannot overlap", () => {
  assert.deepEqual(check({ start: "2026-11-12T10:15", chairId: "c2" }, [appt({})]), ["PROVIDER_OVERLAP"]);
});

test("back-to-back appointments for the same dentist are fine", () => {
  assert.deepEqual(check({ start: "2026-11-12T10:30" }, [appt({})]), []);
});

test("two dentists cannot use the same chair at the same time", () => {
  assert.deepEqual(check({ dentistId: "s-elira", start: "2026-11-12T10:00", chairId: "c1" }, [appt({})]), ["CHAIR_OVERLAP"]);
});

test("a cancelled appointment frees its dentist and chair", () => {
  assert.deepEqual(check({}, [appt({ status: "cancelled" })]), []);
});

test("the same patient cannot be in two places at once", () => {
  assert.deepEqual(check({ patientId: "p-001", dentistId: "s-elira", chairId: "c2" }, [appt({})]), ["PATIENT_OVERLAP"]);
});

test("moving an appointment does not clash with its own old slot", () => {
  assert.deepEqual(check({ patientId: "p-001", start: "2026-11-12T10:15" }, [appt({})], "a-x"), []);
});

test("bookings outside working hours are refused", () => {
  assert.deepEqual(check({ start: "2026-11-12T08:30" }), ["OUTSIDE_HOURS"]);
  assert.deepEqual(check({ start: "2026-11-12T17:45" }), ["OUTSIDE_HOURS"]); // 30 min would end 18:15
  assert.deepEqual(check({ start: "2026-11-15T10:00" }), ["OUTSIDE_HOURS"]); // Sunday: clinic closed
});

test("Saturday hours stop at 13:00 and a dentist's day off is respected", () => {
  assert.deepEqual(check({ start: "2026-11-14T12:45" }), ["OUTSIDE_HOURS"]);
  assert.equal(workingWindow(staff("s-besnik"), "2026-11-11"), null); // Wednesday off
  assert.deepEqual(check({ dentistId: "s-besnik", chairId: "c3", start: "2026-11-11T11:00" }), ["OUTSIDE_HOURS"]);
});

test("a hygienist is not booked for a root canal", () => {
  assert.deepEqual(check({ dentistId: "s-mirela", chairId: "c3", treatmentId: "t-root", start: "2026-11-12T11:00" }), ["TREATMENT_NOT_OFFERED"]);
  assert.equal(mirela.title, "Hygienist");
});

test("nothing can be booked in the past", () => {
  assert.deepEqual(check({ start: "2026-11-10T10:00" }), ["IN_THE_PAST"]);
});

test("cancelling within 24 hours needs a reason, later cancellations do not", () => {
  const soon = appt({ start: "2026-11-12T09:00", end: "2026-11-12T09:30" }); // 23h20 away
  const later = appt({ start: "2026-11-12T10:00" }); // 24h20 away
  assert.equal(isLateCancellation(soon.start, NOW), true);
  assert.equal(isLateCancellation(later.start, NOW), false);
  assert.deepEqual(checkCancellation(soon, undefined, NOW).map((v) => v.code), ["REASON_REQUIRED"]);
  assert.deepEqual(checkCancellation(soon, "  ", NOW).map((v) => v.code), ["REASON_REQUIRED"]);
  assert.deepEqual(checkCancellation(soon, "Patient has the flu", NOW), []);
  assert.deepEqual(checkCancellation(later, undefined, NOW), []);
});

test("an already cancelled or completed appointment cannot be cancelled again", () => {
  assert.equal(checkCancellation(appt({ status: "cancelled" }), "x y z", NOW)[0].code, "ALREADY_CANCELLED");
  assert.equal(checkCancellation(appt({ status: "completed" }), "x y z", NOW)[0].code, "NOT_CANCELLABLE");
});

test("the seeded week obeys every scheduling rule", () => {
  const live = seed.appointments.filter((a) => a.status !== "cancelled");
  for (const a of live) {
    const others = live.filter((o) => o.id !== a.id);
    const v = checkAppointment(a, { provider: staff(a.dentistId), treatment: treat(a.treatmentId), existing: others, now: "2000-01-01T00:00", ignoreId: a.id });
    assert.deepEqual(v, [], `${a.id}: ${JSON.stringify(v)}`);
  }
  assert.ok(arben.active);
});
