import type { Appointment, AppointmentInput, Chair, Note, Patient, Result, Staff, Status, Treatment } from "./types";
import type { LocalDT } from "./time";

export interface Snapshot {
  staff: Staff[];
  chairs: Chair[];
  treatments: Treatment[];
  patients: Patient[];
  appointments: Appointment[];
}

export interface ReportRow {
  dentistId: string;
  name: string;
  title: string;
  bookedMinutes: number;
  availableMinutes: number;
  utilisation: number;
  appointments: number;
  noShows: number;
  completed: number;
  revenueAll: number;
}

export interface WeekReport {
  weekStart: string;
  rows: ReportRow[];
  noShows: number;
  noShowRate: number;
  revenueCompletedAll: number;
  revenueStillToComeAll: number;
  byTreatment: { treatmentId: string; name: string; count: number; revenueAll: number }[];
}

/**
 * The one interface the UI talks to. DemoAdapter keeps everything in the browser; SupabaseAdapter
 * sends the same calls to Postgres, where row level security repeats the rules.
 * Every method takes the acting staff member and returns a Result, never throws for a rule.
 */
export interface ClinicAdapter {
  readonly kind: "demo" | "supabase";
  now(): LocalDT;

  listStaff(actor: Staff): Promise<Result<Staff[]>>;
  listTreatments(): Promise<Treatment[]>;
  listChairs(): Promise<Chair[]>;

  listAppointments(actor: Staff, fromDate: string, toDate: string): Promise<Result<Appointment[]>>;
  createAppointment(actor: Staff, input: AppointmentInput): Promise<Result<Appointment>>;
  moveAppointment(actor: Staff, id: string, change: Partial<Omit<AppointmentInput, "patientId">>): Promise<Result<Appointment>>;
  cancelAppointment(actor: Staff, id: string, reason?: string): Promise<Result<Appointment>>;
  setOutcome(actor: Staff, id: string, status: Extract<Status, "completed" | "no_show">): Promise<Result<Appointment>>;

  listPatients(actor: Staff): Promise<Result<Patient[]>>;
  getPatient(actor: Staff, id: string): Promise<Result<{ patient: Patient; appointments: Appointment[] }>>;
  createPatient(actor: Staff, p: Pick<Patient, "name" | "phone" | "dob" | "dentistId">): Promise<Result<Patient>>;

  listNotes(actor: Staff, patientId: string): Promise<Result<Note[]>>;
  addNote(actor: Staff, patientId: string, text: string): Promise<Result<Note>>;

  weekReport(actor: Staff, weekStart: string): Promise<Result<WeekReport>>;
  setStaffActive(actor: Staff, staffId: string, active: boolean): Promise<Result<Staff>>;

  /** Demo only. */
  reset?(): Promise<void>;
  /** Supabase only. */
  signIn?(email: string, password: string): Promise<Result<Staff>>;
  currentUser?(): Promise<Staff | null>;
  signOut?(): Promise<void>;
}
