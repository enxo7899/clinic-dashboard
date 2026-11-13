"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useClinic } from "../components/ClinicProvider";

const ROLES = [
  { key: "receptionist", label: "Sign in as Receptionist", who: "Gerta Leka", can: "Books, moves and cancels appointments. Cannot open clinical notes.", cant: "Notes, reports, staff" },
  { key: "dentist", label: "Sign in as Dentist", who: "Dr. Elira Dervishi", can: "Sees only her own schedule and patients, writes notes for them.", cant: "Booking, other schedules, reports" },
  { key: "admin", label: "Sign in as Admin", who: "Ilir Marku", can: "Reports and staff management, plus everything reception does.", cant: "Clinical notes" },
] as const;

export default function Login() {
  const { adapter, actor, ready, signInDemo, signInSupabase, signOut } = useClinic();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (ready && actor && new URLSearchParams(window.location.search).has("as"))
      router.replace(actor.role === "admin" ? "/reports/" : "/calendar/");
  }, [ready, actor, router]);

  return (
    <div className="login">
      <section>
        <p className="eyebrow">Bookings for a Tirana dental clinic</p>
        <h1>Replace the paper diary and the WhatsApp thread.</h1>
        <p className="lede">
          One calendar for three dentists and a hygienist, with rules that stop double bookings, late cancellations
          without a reason, and anyone reading clinical notes they shouldn&apos;t. Pick a role and try to break them.
        </p>
      </section>

      {adapter.kind === "demo" ? (
        <section className="signin" aria-labelledby="sb">
          <h2 id="sb">Sandbox sign-in <span className="tag">no passwords, fake data</span></h2>
          <ul className="roles">
            {ROLES.map((r) => (
              <li key={r.key}>
                <button className="btn primary" onClick={() => signInDemo(r.key)}>{r.label}</button>
                <div>
                  <strong>{r.who}</strong>
                  <p>{r.can}</p>
                  <p className="muted">Blocked from: {r.cant}</p>
                </div>
              </li>
            ))}
          </ul>
          {ready && actor && (
            <p className="muted">Signed in as {actor.name}. <button className="link" onClick={signOut}>Sign out</button></p>
          )}
          <p className="muted small">Everything you change is saved in this browser only. &ldquo;Reset demo&rdquo; in the header restores the seeded week.</p>
        </section>
      ) : (
        <section className="signin">
          <h2>Staff sign-in</h2>
          <form onSubmit={async (e) => { e.preventDefault(); setErr(await signInSupabase(email, pw)); }} className="form">
            <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" required /></label>
            <label>Password<input value={pw} onChange={(e) => setPw(e.target.value)} type="password" autoComplete="current-password" required /></label>
            <button className="btn primary" type="submit">Sign in</button>
            {err && <p className="err">{err}</p>}
          </form>
        </section>
      )}
    </div>
  );
}
