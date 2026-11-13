import type { LocalDT } from "./time";

export type Role = "admin" | "receptionist" | "dentist";
export type StaffTitle = "Dentist" | "Hygienist" | "Receptionist" | "Clinic admin";
export type Status = "booked" | "completed" | "no_show" | "cancelled";

/** Working window as minutes from midnight, or null on a day off. Index 0 = Sunday. */
export type WeekHours = Array<[number, number] | null>;

export interface Staff {
  id: string;
  name: string;
  role: Role;
  title: StaffTitle;
  email: string;
  active: boolean;
  /** Only for people who see patients. */
  hours?: WeekHours;
  defaultChair?: string;
}

export interface Chair {
  id: string;
  name: string;
}

export interface Treatment {
  id: string;
  name: string;
  minutes: number;
  priceAll: number;
  /** Which kind of provider performs it. */
  by: "Dentist" | "Hygienist" | "Any";
}

export interface Patient {
  id: string;
  name: string;
  phone: string;
  dob: string;
  /** Treating dentist. Notes belong to this dentist (and anyone who has treated the patient). */
  dentistId: string;
}

export interface Appointment {
  id: string;
  patientId: string;
  dentistId: string;
  chairId: string;
  treatmentId: string;
  start: LocalDT;
  end: LocalDT;
  status: Status;
  cancelReason?: string;
  createdBy: string;
}

export interface Note {
  id: string;
  patientId: string;
  authorId: string;
  at: LocalDT;
  text: string;
}

export interface AppointmentInput {
  patientId: string;
  dentistId: string;
  chairId: string;
  treatmentId: string;
  start: LocalDT;
}

export interface Violation {
  code: string;
  message: string;
}

export type Fail = { ok: false; kind: "permission" | "rule" | "auth" | "error"; violations: Violation[] };
export type Result<T> = { ok: true; value: T } | Fail;
