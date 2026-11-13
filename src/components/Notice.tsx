"use client";
import type { Violation } from "../lib/types";

export function Lock() {
  return (
    <svg className="lock" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** A visible rule: what was blocked and why, with the rule code so visitors can find it in src/lib/rules.ts. */
export function RuleNotice({ title, violations, kind, onClose }: { title: string; violations: Violation[]; kind?: string; onClose?: () => void }) {
  return (
    <div className={`notice ${kind === "permission" ? "notice-perm" : ""}`} role="alert">
      <div className="notice-head">
        <span className="tag"><Lock /> {kind === "permission" ? "Permission rule" : "Scheduling rule"}</span>
        <strong>{title}</strong>
        {onClose && <button className="link" onClick={onClose} aria-label="Dismiss">Dismiss</button>}
      </div>
      <ul>
        {violations.map((v, i) => (
          <li key={i}>{v.message} <code>{v.code}</code></li>
        ))}
      </ul>
    </div>
  );
}

export function LockedPanel({ title, message }: { title: string; message: string }) {
  return (
    <div className="locked">
      <div className="tag"><Lock /> Locked for your role</div>
      <h3>{title}</h3>
      <p>{message}</p>
    </div>
  );
}
