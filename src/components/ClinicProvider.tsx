"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ClinicAdapter } from "../lib/adapter";
import { getAdapter } from "../lib/getAdapter";
import { DEMO_LOGINS, STAFF } from "../lib/seed";
import type { Staff, Violation } from "../lib/types";

export type DemoRole = keyof typeof DEMO_LOGINS;
const SESSION_KEY = "lumi-session";

interface Ctx {
  adapter: ClinicAdapter;
  actor: Staff | null;
  ready: boolean;
  /** Bumps after every write so screens reload. */
  rev: number;
  bump(): void;
  signInDemo(role: DemoRole): void;
  signInSupabase(email: string, password: string): Promise<string | null>;
  signOut(): void;
  resetDemo(): Promise<void>;
  rule: { title: string; violations: Violation[]; kind: string } | null;
  showRule(title: string, violations: Violation[], kind?: string): void;
  clearRule(): void;
  toast: string | null;
  say(msg: string): void;
}

const C = createContext<Ctx | null>(null);
export const useClinic = () => {
  const v = useContext(C);
  if (!v) throw new Error("ClinicProvider missing");
  return v;
};

function readSession(): string | null {
  try { return window.sessionStorage.getItem(SESSION_KEY); } catch { return null; }
}
function writeSession(v: string | null) {
  try { v ? window.sessionStorage.setItem(SESSION_KEY, v) : window.sessionStorage.removeItem(SESSION_KEY); } catch { /* blocked storage */ }
}

export function ClinicProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const adapter = useMemo(() => getAdapter(), []);
  const [actor, setActor] = useState<Staff | null>(null);
  const [ready, setReady] = useState(false);
  const [rev, setRev] = useState(0);
  const [rule, setRule] = useState<Ctx["rule"]>(null);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      const as = new URLSearchParams(window.location.search).get("as") as DemoRole | null;
      if (adapter.kind === "demo") {
        const id = as && DEMO_LOGINS[as] ? DEMO_LOGINS[as] : readSession();
        if (as && DEMO_LOGINS[as]) writeSession(id);
        setActor(STAFF.find((s) => s.id === id) ?? null);
      } else {
        setActor((await adapter.currentUser?.()) ?? null);
      }
      setReady(true);
    })();
  }, [adapter]);

  const say = useCallback((msg: string) => {
    setToast(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const value: Ctx = {
    adapter, actor, ready, rev, rule, toast, say,
    bump: () => setRev((r) => r + 1),
    signInDemo(role) {
      const id = DEMO_LOGINS[role];
      writeSession(id);
      setActor(STAFF.find((s) => s.id === id) ?? null);
      setRule(null);
      router.push(role === "admin" ? "/reports/" : "/calendar/");
    },
    async signInSupabase(email, password) {
      const r = await adapter.signIn?.(email, password);
      if (!r || !r.ok) return r && !r.ok ? r.violations[0].message : "Sign-in is not available.";
      setActor(r.value);
      router.push(r.value.role === "admin" ? "/reports/" : "/calendar/");
      return null;
    },
    signOut() {
      writeSession(null);
      void adapter.signOut?.();
      setActor(null);
      setRule(null);
      router.push("/");
    },
    async resetDemo() {
      await adapter.reset?.();
      setRev((r) => r + 1);
      setRule(null);
      say("Demo data reset to the seeded week.");
    },
    showRule: (title, violations, kind = "rule") => setRule({ title, violations, kind }),
    clearRule: () => setRule(null),
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}
