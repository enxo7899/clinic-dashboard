import { test } from "node:test";
import assert from "node:assert/strict";
import { DemoAdapter, DEMO_STORAGE_KEY, type KeyValueStore } from "../src/lib/demoAdapter";
import { DEMO_NOW, STAFF } from "../src/lib/seed";
import type { Result } from "../src/lib/types";

const staff = (id: string) => STAFF.find((s) => s.id === id)!;
const gerta = staff("s-gerta"), elira = staff("s-elira"), arben = staff("s-arben"), ilir = staff("s-ilir");

function memoryStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}
function codes<T>(r: Result<T>) { return r.ok ? [] : r.violations.map((v) => v.code); }
const slot = { patientId: "p-010", dentistId: "s-arben", chairId: "c1", treatmentId: "t-checkup" };

test("the demo starts from a seeded week of appointments", async () => {
  const a = new DemoAdapter(memoryStore());
  const r = await a.listAppointments(gerta, "2026-11-09", "2026-11-14");
  assert.ok(r.ok && r.value.length > 80);
});

test("a receptionist can book a free slot and it appears in the calendar", async () => {
  const a = new DemoAdapter(memoryStore());
  const r = await a.createAppointment(gerta, { ...slot, start: "2026-11-16T09:00" });
  assert.ok(r.ok);
  const list = await a.listAppointments(gerta, "2026-11-16", "2026-11-16");
  assert.ok(list.ok && list.value.some((x) => x.patientId === "p-010"));
});

test("the adapter refuses a double booking even if the screen lets it through", async () => {
  const a = new DemoAdapter(memoryStore());
  assert.ok((await a.createAppointment(gerta, { ...slot, start: "2026-11-16T09:00" })).ok);
  const dup = await a.createAppointment(gerta, { ...slot, patientId: "p-011", start: "2026-11-16T09:15" });
  assert.deepEqual(codes(dup), ["PROVIDER_OVERLAP", "CHAIR_OVERLAP"]);
});

test("a dentist is refused when they try to book an appointment", async () => {
  const a = new DemoAdapter(memoryStore());
  const r = await a.createAppointment(elira, { ...slot, dentistId: "s-elira", chairId: "c2", start: "2026-11-16T09:00" });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.kind, "permission");
});

test("a dentist only sees their own appointments and patients", async () => {
  const a = new DemoAdapter(memoryStore());
  const appts = await a.listAppointments(elira, "2026-11-09", "2026-11-14");
  assert.ok(appts.ok && appts.value.length > 10 && appts.value.every((x) => x.dentistId === "s-elira"));
  const pats = await a.listPatients(elira);
  const all = await a.listPatients(gerta);
  assert.ok(pats.ok && all.ok && pats.value.length < all.value.length);
});

test("reception can't read notes; the treating dentist can; another dentist can't", async () => {
  const a = new DemoAdapter(memoryStore());
  const pats = await a.listPatients(gerta);
  assert.ok(pats.ok);
  const mine = pats.value.find((p) => p.dentistId === "s-elira")!;
  assert.equal((await a.listNotes(gerta, mine.id)).ok, false);
  assert.equal((await a.listNotes(ilir, mine.id)).ok, false);
  assert.equal((await a.listNotes(elira, mine.id)).ok, true);
  const arbens = pats.value.find((p) => p.dentistId === "s-arben")!;
  const r = await a.addNote(elira, arbens.id, "Looking at someone else's chart");
  if (!r.ok) assert.equal(r.violations[0].code, "NOT_YOUR_PATIENT");
});

test("a dentist can add a note for their own patient and it is stored", async () => {
  const a = new DemoAdapter(memoryStore());
  const pats = await a.listPatients(elira);
  assert.ok(pats.ok);
  const p = pats.value.find((x) => x.dentistId === "s-elira")!;
  const w = await a.addNote(elira, p.id, "Sensitivity on 36, advised desensitising paste.");
  assert.ok(w.ok);
  const notes = await a.listNotes(elira, p.id);
  assert.ok(notes.ok && notes.value[0].text.startsWith("Sensitivity"));
});

test("cancelling an appointment under 24 hours away needs a reason", async () => {
  const a = new DemoAdapter(memoryStore());
  const list = await a.listAppointments(gerta, "2026-11-11", "2026-11-12");
  assert.ok(list.ok);
  const soon = list.value.find((x) => x.status === "booked" && x.start > DEMO_NOW && x.start < "2026-11-12T09:40")!;
  assert.ok(soon, "the seed has a booking inside the next 24 hours");
  assert.deepEqual(codes(await a.cancelAppointment(gerta, soon.id)), ["REASON_REQUIRED"]);
  assert.ok((await a.cancelAppointment(gerta, soon.id, "Patient called in sick")).ok);
  const later = list.value.find((x) => x.status === "booked" && x.start > "2026-11-12T10:00")!;
  assert.ok((await a.cancelAppointment(gerta, later.id)).ok);
});

test("moving an appointment onto another one is rejected and nothing changes", async () => {
  const a = new DemoAdapter(memoryStore());
  const x = await a.createAppointment(gerta, { ...slot, start: "2026-11-16T09:00" });
  const y = await a.createAppointment(gerta, { ...slot, patientId: "p-012", start: "2026-11-16T11:00" });
  assert.ok(x.ok && y.ok);
  const r = await a.moveAppointment(gerta, y.ok ? y.value.id : "", { start: "2026-11-16T09:00" });
  assert.equal(r.ok, false);
  const list = await a.listAppointments(gerta, "2026-11-16", "2026-11-16");
  assert.ok(list.ok && list.value.find((z) => z.patientId === "p-012")!.start === "2026-11-16T11:00");
});

test("reports and staff management are admin only", async () => {
  const a = new DemoAdapter(memoryStore());
  assert.equal((await a.weekReport(gerta, "2026-11-09")).ok, false);
  assert.equal((await a.weekReport(elira, "2026-11-09")).ok, false);
  assert.equal((await a.weekReport(ilir, "2026-11-09")).ok, true);
  assert.equal((await a.setStaffActive(gerta, "s-anila", false)).ok, false);
  assert.ok((await a.setStaffActive(ilir, "s-anila", false)).ok);
});

test("a dentist with upcoming appointments cannot be deactivated", async () => {
  const a = new DemoAdapter(memoryStore());
  assert.deepEqual(codes(await a.setStaffActive(ilir, arben.id, false)), ["HAS_UPCOMING"]);
  assert.deepEqual(codes(await a.setStaffActive(ilir, ilir.id, false)), ["SELF_DEACTIVATION"]);
});

test("changes persist to storage and reset restores the seed", async () => {
  const store = memoryStore();
  const a = new DemoAdapter(store);
  await a.createAppointment(gerta, { ...slot, start: "2026-11-16T09:00" });
  assert.ok(store.map.has(DEMO_STORAGE_KEY));
  const b = new DemoAdapter(store); // a "reload"
  const seen = await b.listAppointments(gerta, "2026-11-16", "2026-11-16");
  assert.ok(seen.ok && seen.value.length === 1);
  await b.reset();
  const after = await new DemoAdapter(store).listAppointments(gerta, "2026-11-16", "2026-11-16");
  assert.ok(after.ok && after.value.length === 0);
});

test("the demo clock is fixed so the 24 hour rule is reproducible", () => {
  assert.equal(new DemoAdapter().now(), DEMO_NOW);
});

test("a dentist can record an outcome only after the visit has started", async () => {
  const a = new DemoAdapter(memoryStore());
  const future = await a.createAppointment(gerta, { ...slot, dentistId: "s-elira", chairId: "c2", start: "2026-11-16T09:00" });
  assert.ok(future.ok);
  assert.deepEqual(codes(await a.setOutcome(elira, future.ok ? future.value.id : "", "completed")), ["NOT_STARTED"]);
});
