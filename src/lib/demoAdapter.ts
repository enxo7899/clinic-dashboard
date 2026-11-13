import type { ClinicAdapter } from "./adapter";
import { computeWeekReport } from "./reports";
import {
  can, canReadNotes, canSeeAppointment, canSeePatient, canWriteNotes, checkAppointment, checkCancellation,
  checkDeactivation, checkMove, checkOutcome, denied, fail,
} from "./rules";
import { buildSeed, DEMO_NOW, type SeedData } from "./seed";
import { addDays, addMinutes, dateOf, type LocalDT } from "./time";
import type { Appointment, AppointmentInput, Note, Patient, Result, Staff, Status } from "./types";

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export const DEMO_STORAGE_KEY = "lumi-demo-v1";
const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** In-browser store seeded with a realistic week, persisted to localStorage. Enforces rules.ts on every call. */
export class DemoAdapter implements ClinicAdapter {
  readonly kind = "demo" as const;
  private data: SeedData;

  constructor(private store?: KeyValueStore, private clock: LocalDT = DEMO_NOW) {
    this.data = this.load();
  }

  now() { return this.clock; }

  private load(): SeedData {
    try {
      const raw = this.store?.getItem(DEMO_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SeedData;
        if (Array.isArray(parsed.appointments) && Array.isArray(parsed.patients)) return parsed;
      }
    } catch { /* corrupt or blocked storage: start from the seed */ }
    return buildSeed();
  }
  private save() {
    try { this.store?.setItem(DEMO_STORAGE_KEY, JSON.stringify(this.data)); } catch { /* storage full or blocked */ }
  }

  async reset() {
    this.data = buildSeed();
    try { this.store?.removeItem(DEMO_STORAGE_KEY); } catch { /* ignore */ }
  }

  private staffById(id: string) { return this.data.staff.find((s) => s.id === id); }
  private treatmentById(id: string) { return this.data.treatments.find((t) => t.id === id); }
  private appt(id: string) { return this.data.appointments.find((a) => a.id === id); }

  async listStaff(actor: Staff) {
    const staff = can(actor, "staff.manage").ok ? this.data.staff : this.data.staff.filter((s) => s.role === "dentist");
    return ok(clone(staff));
  }
  async listTreatments() { return clone(this.data.treatments); }
  async listChairs() { return clone(this.data.chairs); }

  async listAppointments(actor: Staff, fromDate: string, toDate: string) {
    const list = this.data.appointments.filter((a) => dateOf(a.start) >= fromDate && dateOf(a.start) <= toDate && canSeeAppointment(actor, a));
    return ok(clone(list));
  }

  private validate(input: AppointmentInput, ignoreId?: string) {
    return checkAppointment(input, {
      provider: this.staffById(input.dentistId),
      treatment: this.treatmentById(input.treatmentId),
      existing: this.data.appointments,
      now: this.clock,
      ignoreId,
    });
  }

  async createAppointment(actor: Staff, input: AppointmentInput): Promise<Result<Appointment>> {
    const d = can(actor, "appointment.create");
    if (!d.ok) return denied(d);
    if (!this.data.patients.some((p) => p.id === input.patientId)) return fail("rule", [{ code: "NO_PATIENT", message: "Pick a patient." }]);
    const v = this.validate(input);
    if (v.length) return fail("rule", v);
    const t = this.treatmentById(input.treatmentId)!;
    const n = this.data.appointments.reduce((m, a) => Math.max(m, Number(a.id.slice(2)) || 0), 0) + 1;
    const a: Appointment = {
      id: `a-${String(n).padStart(3, "0")}`, ...input, end: addMinutes(input.start, t.minutes), status: "booked", createdBy: actor.id,
    };
    this.data.appointments.push(a);
    this.save();
    return ok(clone(a));
  }

  async moveAppointment(actor: Staff, id: string, change: Partial<Omit<AppointmentInput, "patientId">>): Promise<Result<Appointment>> {
    const d = can(actor, "appointment.move");
    if (!d.ok) return denied(d);
    const a = this.appt(id);
    if (!a) return fail("error", [{ code: "NOT_FOUND", message: "Appointment not found." }]);
    const mv = checkMove(a);
    if (mv.length) return fail("rule", mv);
    const next: AppointmentInput = { patientId: a.patientId, dentistId: a.dentistId, chairId: a.chairId, treatmentId: a.treatmentId, start: a.start, ...change };
    const v = this.validate(next, a.id);
    if (v.length) return fail("rule", v);
    const t = this.treatmentById(next.treatmentId)!;
    Object.assign(a, next, { end: addMinutes(next.start, t.minutes) });
    this.save();
    return ok(clone(a));
  }

  async cancelAppointment(actor: Staff, id: string, reason?: string): Promise<Result<Appointment>> {
    const d = can(actor, "appointment.cancel");
    if (!d.ok) return denied(d);
    const a = this.appt(id);
    if (!a) return fail("error", [{ code: "NOT_FOUND", message: "Appointment not found." }]);
    const v = checkCancellation(a, reason, this.clock);
    if (v.length) return fail("rule", v);
    a.status = "cancelled";
    a.cancelReason = reason?.trim() || undefined;
    this.save();
    return ok(clone(a));
  }

  async setOutcome(actor: Staff, id: string, status: Extract<Status, "completed" | "no_show">): Promise<Result<Appointment>> {
    const d = can(actor, "appointment.set_outcome");
    if (!d.ok) return denied(d);
    const a = this.appt(id);
    if (!a) return fail("error", [{ code: "NOT_FOUND", message: "Appointment not found." }]);
    if (!canSeeAppointment(actor, a)) return fail("permission", [{ code: "FORBIDDEN", message: "Dentists can only update their own appointments." }]);
    const v = checkOutcome(a, this.clock);
    if (v.length) return fail("rule", v);
    a.status = status;
    this.save();
    return ok(clone(a));
  }

  async listPatients(actor: Staff) {
    const list = this.data.patients.filter((p) => canSeePatient(actor, p, this.data.appointments));
    return ok(clone(list));
  }

  async getPatient(actor: Staff, id: string) {
    const p = this.data.patients.find((x) => x.id === id);
    if (!p) return fail("error", [{ code: "NOT_FOUND", message: "Patient not found." }]);
    if (!canSeePatient(actor, p, this.data.appointments))
      return fail("permission", [{ code: "NOT_YOUR_PATIENT", message: `${p.name} is not your patient. Dentists only see their own patients.` }]);
    const appts = this.data.appointments.filter((a) => a.patientId === id && canSeeAppointment(actor, a));
    return ok(clone({ patient: p, appointments: appts }));
  }

  async createPatient(actor: Staff, input: Pick<Patient, "name" | "phone" | "dob" | "dentistId">): Promise<Result<Patient>> {
    const d = can(actor, "patient.create");
    if (!d.ok) return denied(d);
    if (input.name.trim().length < 3) return fail("rule", [{ code: "NAME_REQUIRED", message: "Enter the patient's full name." }]);
    const n = this.data.patients.reduce((m, p) => Math.max(m, Number(p.id.slice(2)) || 0), 0) + 1;
    const p: Patient = { id: `p-${String(n).padStart(3, "0")}`, ...input, name: input.name.trim() };
    this.data.patients.push(p);
    this.save();
    return ok(clone(p));
  }

  async listNotes(actor: Staff, patientId: string): Promise<Result<Note[]>> {
    const p = this.data.patients.find((x) => x.id === patientId);
    if (!p) return fail("error", [{ code: "NOT_FOUND", message: "Patient not found." }]);
    const d = canReadNotes(actor, p, this.data.appointments);
    if (!d.ok) return denied(d);
    return ok(clone(this.data.notes.filter((n) => n.patientId === patientId).sort((a, b) => b.at.localeCompare(a.at))));
  }

  async addNote(actor: Staff, patientId: string, text: string): Promise<Result<Note>> {
    const p = this.data.patients.find((x) => x.id === patientId);
    if (!p) return fail("error", [{ code: "NOT_FOUND", message: "Patient not found." }]);
    const d = canWriteNotes(actor, p, this.data.appointments);
    if (!d.ok) return denied(d);
    if (text.trim().length < 3) return fail("rule", [{ code: "EMPTY_NOTE", message: "Write something in the note first." }]);
    const n = this.data.notes.reduce((m, x) => Math.max(m, Number(x.id.slice(2)) || 0), 0) + 1;
    const note: Note = { id: `n-${String(n).padStart(3, "0")}`, patientId, authorId: actor.id, at: this.clock, text: text.trim() };
    this.data.notes.push(note);
    this.save();
    return ok(clone(note));
  }

  async weekReport(actor: Staff, weekStart: string) {
    const d = can(actor, "report.view");
    if (!d.ok) return denied(d);
    return ok(computeWeekReport(weekStart, this.data.staff, this.data.treatments, this.data.appointments.filter((a) => a.start >= weekStart && a.start < addDays(weekStart, 7))));
  }

  async setStaffActive(actor: Staff, staffId: string, active: boolean): Promise<Result<Staff>> {
    const d = can(actor, "staff.manage");
    if (!d.ok) return denied(d);
    const s = this.staffById(staffId);
    if (!s) return fail("error", [{ code: "NOT_FOUND", message: "Staff member not found." }]);
    if (!active) {
      const v = checkDeactivation(s, actor, this.data.appointments, this.clock);
      if (v.length) return fail("rule", v);
    }
    s.active = active;
    this.save();
    return ok(clone(s));
  }
}
