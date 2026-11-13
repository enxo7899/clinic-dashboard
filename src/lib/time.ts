// Clinic-local wall-clock time as "YYYY-MM-DDTHH:mm". No time zones: the clinic is in one place.
export type LocalDT = string;

export function toMinutes(dt: LocalDT): number {
  const [d, t] = dt.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  return Date.UTC(y, mo - 1, da, h, mi) / 60000;
}

export function fromMinutes(m: number): LocalDT {
  const d = new Date(m * 60000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export const addMinutes = (dt: LocalDT, n: number): LocalDT => fromMinutes(toMinutes(dt) + n);
export const dateOf = (dt: LocalDT): string => dt.slice(0, 10);
export const timeOf = (dt: LocalDT): string => dt.slice(11, 16);
export const minuteOfDay = (dt: LocalDT): number => {
  const [h, m] = timeOf(dt).split(":").map(Number);
  return h * 60 + m;
};
export const hhmm = (mins: number): string =>
  `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
export const parseHHMM = (s: string): number => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};

/** 0 = Sunday ... 6 = Saturday */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date: string, n: number): string {
  return dateOf(fromMinutes(toMinutes(`${date}T00:00`) + n * 1440));
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  const wd = weekdayOf(date);
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayName = (date: string) => DAY[weekdayOf(date)];
export function prettyDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${dayName(date)} ${d} ${MONTH[m - 1]}`;
}
export function prettyDateTime(dt: LocalDT): string {
  return `${prettyDate(dateOf(dt))}, ${timeOf(dt)}`;
}
