import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ClinicAdapter } from "./adapter";
import { computeWeekReport } from "./reports";
import { can, denied, fail } from "./rules";
import { addDays, type LocalDT } from "./time";
import type { Appointment, AppointmentInput, Chair, Note, Patient, Result, Staff, Status, Treatment } from "./types";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ts = (v: string): LocalDT => v.slice(0, 16).replace(" ", "T");
const toStaff = (r: Row): Staff => ({ id: r.id, name: r.name, role: r.role, title: r.title, email: r.email, active: r.active, hours: r.hours ?? undefined, defaultChair: r.default_chair ?? undefined });
const toAppt = (r: Row): Appointment => ({ id: r.id, patientId: r.patient_id, dentistId: r.dentist_id, chairId: r.chair_id, treatmentId: r.treatment_id, start: ts(r.starts_at), end: ts(r.ends_at), status: r.status, cancelReason: r.cancel_reason ?? undefined, createdBy: r.created_by ?? "" });
const toPatient = (r: Row): Patient => ({ id: r.id, name: r.name, phone: r.phone ?? "", dob: r.dob ?? "", dentistId: r.dentist_id });
const toNote = (r: Row): Note => ({ id: r.id, patientId: r.patient_id, authorId: r.author_id, at: ts(r.at), text: r.text });
const toTreatment = (r: Row): Treatment => ({ id: r.id, name: r.name, minutes: r.minutes, priceAll: r.price_all, by: r.performed_by });

const CONSTRAINTS: Record<string, [string, string]> = {
  no_dentist_overlap: ["PROVIDER_OVERLAP", "That dentist already has an appointment at this time."],
  no_chair_overlap: ["CHAIR_OVERLAP", "That chair is already in use at this time."],
  no_patient_overlap: ["PATIENT_OVERLAP", "The patient already has an appointment at this time."],
};

/** Turns a Postgres / PostgREST error into the same Result shape the demo adapter returns. */
export function mapDbError(e: { code?: string; message: string }): ReturnType<typeof fail> {
  for (const [name, [code, message]] of Object.entries(CONSTRAINTS)) if (e.message.includes(name)) return fail("rule", [{ code, message }]);
  if (e.code === "42501" || /row-level security|cannot create|can only record/i.test(e.message))
    return fail("permission", [{ code: "FORBIDDEN", message: "The database refused this: your role is not allowed to do that." }]);
  if (/24 hours/.test(e.message)) return fail("rule", [{ code: "REASON_REQUIRED", message: "Cancelling within 24 hours needs a written reason." }]);
  return fail("rule", [{ code: "DB_RULE", message: e.message }]);
}

/** Same interface as DemoAdapter, backed by Supabase. Row level security in supabase/migrations is the real gatekeeper. */
export class SupabaseAdapter implements ClinicAdapter {
  readonly kind = "supabase" as const;
  private db: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.db = createClient(url, anonKey);
  }

  now(): LocalDT {
    const p = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Tirane", dateStyle: "short", timeStyle: "short" }).format(new Date());
    return p.replace(" ", "T");
  }

  async signIn(email: string, password: string): Promise<Result<Staff>> {
    const { error } = await this.db.auth.signInWithPassword({ email, password });
    if (error) return fail("auth", [{ code: "AUTH", message: error.message }]);
    const me = await this.currentUser();
    return me ? { ok: true, value: me } : fail("auth", [{ code: "NO_STAFF", message: "This login is not linked to a staff row. See the README, step 4." }]);
  }
  async currentUser(): Promise<Staff | null> {
    const { data } = await this.db.auth.getUser();
    if (!data.user) return null;
    const { data: row } = await this.db.from("staff").select("*").eq("auth_user_id", data.user.id).eq("active", true).maybeSingle();
    return row ? toStaff(row) : null;
  }
  async signOut() { await this.db.auth.signOut(); }

  async listStaff(): Promise<Result<Staff[]>> {
    const { data, error } = await this.db.from("staff").select("*").order("name");
    return error ? mapDbError(error) : { ok: true, value: (data ?? []).map(toStaff) };
  }
  async listTreatments(): Promise<Treatment[]> {
    const { data } = await this.db.from("treatments").select("*").order("name");
    return (data ?? []).map(toTreatment);
  }
  async listChairs(): Promise<Chair[]> {
    const { data } = await this.db.from("chairs").select("*").order("id");
    return (data ?? []) as Chair[];
  }

  async listAppointments(_a: Staff, from: string, to: string): Promise<Result<Appointment[]>> {
    const { data, error } = await this.db.from("appointments").select("*").gte("starts_at", `${from}T00:00`).lt("starts_at", `${addDays(to, 1)}T00:00`).order("starts_at");
    return error ? mapDbError(error) : { ok: true, value: (data ?? []).map(toAppt) };
  }

  async createAppointment(actor: Staff, i: AppointmentInput): Promise<Result<Appointment>> {
    const d = can(actor, "appointment.create");
    if (!d.ok) return denied(d);
    const { data, error } = await this.db.from("appointments").insert({
      patient_id: i.patientId, dentist_id: i.dentistId, chair_id: i.chairId, treatment_id: i.treatmentId, starts_at: i.start, ends_at: i.start, created_by: actor.id,
    }).select("*").single();
    return error ? mapDbError(error) : { ok: true, value: toAppt(data) };
  }

  async moveAppointment(actor: Staff, id: string, c: Partial<Omit<AppointmentInput, "patientId">>): Promise<Result<Appointment>> {
    const d = can(actor, "appointment.move");
    if (!d.ok) return denied(d);
    const patch: Row = {};
    if (c.dentistId) patch.dentist_id = c.dentistId;
    if (c.chairId) patch.chair_id = c.chairId;
    if (c.treatmentId) patch.treatment_id = c.treatmentId;
    if (c.start) patch.starts_at = c.start;
    const { data, error } = await this.db.from("appointments").update(patch).eq("id", id).select("*").single();
    return error ? mapDbError(error) : { ok: true, value: toAppt(data) };
  }

  async cancelAppointment(actor: Staff, id: string, reason?: string): Promise<Result<Appointment>> {
    const d = can(actor, "appointment.cancel");
    if (!d.ok) return denied(d);
    const { data, error } = await this.db.from("appointments").update({ status: "cancelled", cancel_reason: reason?.trim() || null }).eq("id", id).select("*").single();
    return error ? mapDbError(error) : { ok: true, value: toAppt(data) };
  }

  async setOutcome(_a: Staff, id: string, status: Extract<Status, "completed" | "no_show">): Promise<Result<Appointment>> {
    const { data, error } = await this.db.from("appointments").update({ status }).eq("id", id).select("*").single();
    return error ? mapDbError(error) : { ok: true, value: toAppt(data) };
  }

  async listPatients(): Promise<Result<Patient[]>> {
    const { data, error } = await this.db.from("patients").select("*").order("name");
    return error ? mapDbError(error) : { ok: true, value: (data ?? []).map(toPatient) };
  }
  async getPatient(_a: Staff, id: string): Promise<Result<{ patient: Patient; appointments: Appointment[] }>> {
    const { data, error } = await this.db.from("patients").select("*").eq("id", id).maybeSingle();
    if (error) return mapDbError(error);
    if (!data) return fail("permission", [{ code: "NOT_YOUR_PATIENT", message: "This patient doesn't exist or isn't yours. Dentists only see their own patients." }]);
    const { data: appts } = await this.db.from("appointments").select("*").eq("patient_id", id).order("starts_at");
    return { ok: true, value: { patient: toPatient(data), appointments: (appts ?? []).map(toAppt) } };
  }
  async createPatient(actor: Staff, p: Pick<Patient, "name" | "phone" | "dob" | "dentistId">): Promise<Result<Patient>> {
    const d = can(actor, "patient.create");
    if (!d.ok) return denied(d);
    const { data, error } = await this.db.from("patients").insert({ name: p.name, phone: p.phone, dob: p.dob || null, dentist_id: p.dentistId }).select("*").single();
    return error ? mapDbError(error) : { ok: true, value: toPatient(data) };
  }

  async listNotes(actor: Staff, patientId: string): Promise<Result<Note[]>> {
    const d = can(actor, "notes.read");
    if (!d.ok) return denied(d);
    const { data, error } = await this.db.from("notes").select("*").eq("patient_id", patientId).order("at", { ascending: false });
    return error ? mapDbError(error) : { ok: true, value: (data ?? []).map(toNote) };
  }
  async addNote(actor: Staff, patientId: string, text: string): Promise<Result<Note>> {
    const d = can(actor, "notes.write");
    if (!d.ok) return denied(d);
    const { data, error } = await this.db.from("notes").insert({ patient_id: patientId, author_id: actor.id, text }).select("*").single();
    return error ? mapDbError(error) : { ok: true, value: toNote(data) };
  }

  async weekReport(actor: Staff, weekStart: string) {
    const d = can(actor, "report.view");
    if (!d.ok) return denied(d);
    const [staff, appts, tr] = await Promise.all([this.listStaff(), this.listAppointments(actor, weekStart, addDays(weekStart, 6)), this.listTreatments()]);
    if (!staff.ok) return staff;
    if (!appts.ok) return appts;
    return { ok: true as const, value: computeWeekReport(weekStart, staff.value, tr, appts.value) };
  }

  async setStaffActive(actor: Staff, id: string, active: boolean): Promise<Result<Staff>> {
    const d = can(actor, "staff.manage");
    if (!d.ok) return denied(d);
    const { data, error } = await this.db.from("staff").update({ active }).eq("id", id).select("*").single();
    return error ? mapDbError(error) : { ok: true, value: toStaff(data) };
  }
}
