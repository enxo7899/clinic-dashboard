// Every permission and scheduling rule lives here as pure functions: no I/O, no React.
// The demo adapter calls them on every write; the Supabase migrations repeat the same rules
// as RLS policies, an exclusion constraint and triggers, so the database refuses a bad write too.
import { addMinutes, dateOf, minuteOfDay, toMinutes, weekdayOf, hhmm, type LocalDT } from "./time";
import type { Appointment, AppointmentInput, Fail, Patient, Role, Staff, Treatment, Violation } from "./types";

export const CANCEL_NOTICE_HOURS = 24;

/** Clinic opening hours, Sunday = index 0. Providers may work a shorter window inside these. */
export const CLINIC_HOURS: Array<[number, number] | null> = [
  null,
  [540, 1080],
  [540, 1080],
  [540, 1080],
  [540, 1080],
  [540, 1080],
  [540, 780],
];

export type Action =
  | "appointment.view_all"
  | "appointment.create"
  | "appointment.move"
  | "appointment.cancel"
  | "appointment.set_outcome"
  | "patient.list_all"
  | "patient.create"
  | "notes.read"
  | "notes.write"
  | "report.view"
  | "staff.manage";

export type Decision = { ok: true } | { ok: false; code: string; message: string };

const ROLE_LABEL: Record<Role, string> = { admin: "Admins", receptionist: "Receptionists", dentist: "Dentists" };

const MATRIX: Record<Action, Role[]> = {
  "appointment.view_all": ["admin", "receptionist"],
  "appointment.create": ["admin", "receptionist"],
  "appointment.move": ["admin", "receptionist"],
  "appointment.cancel": ["admin", "receptionist"],
  "appointment.set_outcome": ["admin", "receptionist", "dentist"],
  "patient.list_all": ["admin", "receptionist"],
  "patient.create": ["admin", "receptionist"],
  "notes.read": ["dentist"],
  "notes.write": ["dentist"],
  "report.view": ["admin"],
  "staff.manage": ["admin"],
};

const DENIED_TEXT: Record<Action, string> = {
  "appointment.view_all": "see other dentists' schedules. Dentists only see their own appointments",
  "appointment.create": "create appointments. Booking is done by reception",
  "appointment.move": "move appointments. Changes go through reception",
  "appointment.cancel": "cancel appointments. Cancellations go through reception",
  "appointment.set_outcome": "record an outcome",
  "patient.list_all": "browse the full patient list. Dentists only see their own patients",
  "patient.create": "register patients. Registration is done by reception",
  "notes.read": "open clinical notes. Only the treating dentist can read them",
  "notes.write": "write clinical notes. Only the treating dentist can",
  "report.view": "open reports. Reports are for the clinic admin",
  "staff.manage": "manage staff. That is the clinic admin's job",
};

/** Role-level check. Use `canReadNotes` / `canWriteNotes` for the per-patient part. */
export function can(actor: Pick<Staff, "role">, action: Action): Decision {
  if (MATRIX[action].includes(actor.role)) return { ok: true };
  return {
    ok: false,
    code: "FORBIDDEN",
    message: `${ROLE_LABEL[actor.role]} can't ${DENIED_TEXT[action]}.`,
  };
}

/** A dentist's own patient: the assigned dentist, or someone who has an appointment with them. */
export function isOwnPatient(actor: Staff, patient: Patient, appts: Appointment[]): boolean {
  if (actor.role !== "dentist") return false;
  if (patient.dentistId === actor.id) return true;
  return appts.some((a) => a.patientId === patient.id && a.dentistId === actor.id && a.status !== "cancelled");
}

export function canReadNotes(actor: Staff, patient: Patient, appts: Appointment[]): Decision {
  const base = can(actor, "notes.read");
  if (!base.ok) return base;
  if (!isOwnPatient(actor, patient, appts))
    return { ok: false, code: "NOT_YOUR_PATIENT", message: `${patient.name} is not your patient, so their notes are closed to you.` };
  return { ok: true };
}

export function canWriteNotes(actor: Staff, patient: Patient, appts: Appointment[]): Decision {
  const base = can(actor, "notes.write");
  if (!base.ok) return base;
  if (!isOwnPatient(actor, patient, appts))
    return { ok: false, code: "NOT_YOUR_PATIENT", message: `${patient.name} is not your patient, so you can't write notes for them.` };
  return { ok: true };
}

/** Dentists see only their own appointments; reception and admin see all. */
export function canSeeAppointment(actor: Staff, appt: Appointment): boolean {
  return can(actor, "appointment.view_all").ok || appt.dentistId === actor.id;
}

export function canSeePatient(actor: Staff, patient: Patient, appts: Appointment[]): boolean {
  return can(actor, "patient.list_all").ok || isOwnPatient(actor, patient, appts);
}

/** Working window for a provider on a date: clinic hours narrowed by their own hours. */
export function workingWindow(provider: Staff, date: string): [number, number] | null {
  const wd = weekdayOf(date);
  const clinic = CLINIC_HOURS[wd];
  const own = provider.hours?.[wd] ?? null;
  if (!clinic || !own) return null;
  const s = Math.max(clinic[0], own[0]);
  const e = Math.min(clinic[1], own[1]);
  return e > s ? [s, e] : null;
}

export const overlaps = (aStart: LocalDT, aEnd: LocalDT, bStart: LocalDT, bEnd: LocalDT): boolean =>
  toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);

export interface SchedulingContext {
  provider: Staff | undefined;
  treatment: Treatment | undefined;
  /** Every appointment in the clinic (cancelled ones are ignored here). */
  existing: Appointment[];
  now: LocalDT;
  /** The appointment being moved, so it does not clash with itself. */
  ignoreId?: string;
}

/** All reasons this booking is not allowed. An empty list means it is fine. */
export function checkAppointment(input: AppointmentInput, ctx: SchedulingContext): Violation[] {
  const out: Violation[] = [];
  const { provider, treatment } = ctx;
  if (!provider || !provider.active || (provider.role !== "dentist")) {
    out.push({ code: "NO_PROVIDER", message: "Pick an active dentist or hygienist." });
    return out;
  }
  if (!treatment) {
    out.push({ code: "NO_TREATMENT", message: "Pick a treatment." });
    return out;
  }
  const end = addMinutes(input.start, treatment.minutes);

  if (toMinutes(input.start) < toMinutes(ctx.now)) {
    out.push({ code: "IN_THE_PAST", message: "That time has already passed." });
  }
  if (treatment.by !== "Any" && treatment.by !== provider.title) {
    out.push({ code: "TREATMENT_NOT_OFFERED", message: `${treatment.name} is done by a ${treatment.by.toLowerCase()}, not ${provider.name}.` });
  }

  const win = workingWindow(provider, dateOf(input.start));
  if (!win) {
    out.push({ code: "OUTSIDE_HOURS", message: `${provider.name} does not work on ${dateOf(input.start)}.` });
  } else {
    const s = minuteOfDay(input.start);
    const e = s + treatment.minutes;
    if (dateOf(end) !== dateOf(input.start) || s < win[0] || e > win[1]) {
      out.push({
        code: "OUTSIDE_HOURS",
        message: `${provider.name} works ${hhmm(win[0])}–${hhmm(win[1])} that day; this runs ${hhmm(s)}–${hhmm(e % 1440)}.`,
      });
    }
  }

  for (const a of ctx.existing) {
    if (a.id === ctx.ignoreId || a.status === "cancelled") continue;
    if (!overlaps(input.start, end, a.start, a.end)) continue;
    if (a.dentistId === input.dentistId) {
      out.push({ code: "PROVIDER_OVERLAP", message: `${provider.name} already has an appointment ${a.start.slice(11)}–${a.end.slice(11)}.` });
    }
    if (a.chairId === input.chairId) {
      out.push({ code: "CHAIR_OVERLAP", message: `Chair is already in use ${a.start.slice(11)}–${a.end.slice(11)}.` });
    }
    if (a.patientId === input.patientId) {
      out.push({ code: "PATIENT_OVERLAP", message: `The patient already has an appointment ${a.start.slice(11)}–${a.end.slice(11)}.` });
    }
  }
  return dedupe(out);
}

function dedupe(v: Violation[]): Violation[] {
  const seen = new Set<string>();
  return v.filter((x) => (seen.has(x.code + x.message) ? false : (seen.add(x.code + x.message), true)));
}

/** True when the appointment starts less than 24 hours from now. */
export function isLateCancellation(start: LocalDT, now: LocalDT): boolean {
  return toMinutes(start) - toMinutes(now) < CANCEL_NOTICE_HOURS * 60;
}

export function checkCancellation(appt: Appointment, reason: string | undefined, now: LocalDT): Violation[] {
  const out: Violation[] = [];
  if (appt.status === "cancelled") out.push({ code: "ALREADY_CANCELLED", message: "This appointment is already cancelled." });
  else if (appt.status !== "booked") out.push({ code: "NOT_CANCELLABLE", message: "Only booked appointments can be cancelled." });
  if (appt.status === "booked" && isLateCancellation(appt.start, now) && !(reason && reason.trim().length >= 3)) {
    out.push({
      code: "REASON_REQUIRED",
      message: `This starts in under ${CANCEL_NOTICE_HOURS} hours. Cancelling needs a written reason.`,
    });
  }
  return out;
}

export function checkMove(appt: Appointment): Violation[] {
  return appt.status === "booked"
    ? []
    : [{ code: "NOT_MOVABLE", message: "Only booked appointments can be moved." }];
}

export const fail = (kind: Fail["kind"], violations: Violation[]): Fail => ({ ok: false, kind, violations });
export const denied = (d: Extract<Decision, { ok: false }>): Fail => fail("permission", [{ code: d.code, message: d.message }]);

/** A provider with upcoming booked appointments cannot be switched off. */
export function checkDeactivation(target: Staff, actor: Staff, appts: Appointment[], now: LocalDT): Violation[] {
  const out: Violation[] = [];
  if (target.id === actor.id) out.push({ code: "SELF_DEACTIVATION", message: "You can't deactivate your own account." });
  const upcoming = appts.filter((a) => a.dentistId === target.id && a.status === "booked" && toMinutes(a.start) >= toMinutes(now));
  if (upcoming.length)
    out.push({ code: "HAS_UPCOMING", message: `${target.name} still has ${upcoming.length} upcoming appointment${upcoming.length > 1 ? "s" : ""}. Move or cancel them first.` });
  return out;
}

/** Outcomes (completed / no-show) can only be recorded once the appointment has started. */
export function checkOutcome(appt: Appointment, now: LocalDT): Violation[] {
  if (appt.status !== "booked") return [{ code: "NOT_BOOKED", message: "Only booked appointments can get an outcome." }];
  if (toMinutes(appt.start) > toMinutes(now)) return [{ code: "NOT_STARTED", message: "This appointment hasn't started yet." }];
  return [];
}
