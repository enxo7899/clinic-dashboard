"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useClinic } from "./ClinicProvider";
import { Lock } from "./Notice";
import { can } from "../lib/rules";
import { prettyDate, dateOf, timeOf } from "../lib/time";

const ROLE_NAME = { admin: "Admin", receptionist: "Receptionist", dentist: "Dentist" } as const;

export function Shell({ children }: { children: ReactNode }) {
  const { actor, adapter, signOut, resetDemo, ready } = useClinic();
  const path = usePathname() ?? "";
  const nav = [
    { href: "/calendar/", label: "Calendar", locked: false },
    { href: "/patients/", label: "Patients", locked: false },
    { href: "/reports/", label: "Reports", locked: actor ? !can(actor, "report.view").ok : false },
    { href: "/staff/", label: "Staff", locked: actor ? !can(actor, "staff.manage").ok : false },
  ];
  const now = adapter.now();
  return (
    <>
      <div className="banner">
        Live demo by EmSoft. Klinika Dental Lumi is a fictional dental clinic.{" "}
        <a href="https://github.com/enxo7899/clinic-dashboard">Source on GitHub</a>
      </div>
      <header className="top">
        <Link href="/" className="brand" aria-label="Klinika Dental Lumi, home">
          <span className="brand-mark" aria-hidden="true" />
          <span>Klinika Dental <em>Lumi</em></span>
        </Link>
        {ready && actor && (
          <>
            <nav className="nav" aria-label="Main">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className={path.startsWith(n.href.slice(0, -1)) ? "on" : ""}>
                  {n.label}{n.locked && <Lock />}
                </Link>
              ))}
            </nav>
            <div className="who">
              <div className="who-name">
                <strong>{actor.name}</strong>
                <span>{ROLE_NAME[actor.role]}{adapter.kind === "demo" ? " · sandbox" : ""}</span>
              </div>
              {adapter.kind === "demo" && (
                <span className="clock" title="The demo clock is fixed so the 24-hour rule behaves the same for every visitor">
                  Demo clock {prettyDate(dateOf(now))}, <span className="mono">{timeOf(now)}</span>
                </span>
              )}
              <div className="who-actions">
                {adapter.kind === "demo" && <button className="btn ghost sm" onClick={() => void resetDemo()}>Reset demo</button>}
                <button className="btn ghost sm" onClick={signOut}>Switch role</button>
              </div>
            </div>
          </>
        )}
      </header>
      <main className="main">{children}</main>
    </>
  );
}

/** Wraps a screen: waits for the session, and sends signed-out visitors to the login. */
export function NeedsLogin({ children }: { children: ReactNode }) {
  const { ready, actor } = useClinic();
  if (!ready) return <p className="muted pad">Loading…</p>;
  if (!actor)
    return (
      <div className="pad">
        <h1>Sign in first</h1>
        <p>This screen needs a staff role. <Link href="/">Go to the sign-in screen</Link>.</p>
      </div>
    );
  return <>{children}</>;
}
