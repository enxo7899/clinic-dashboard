import type { ClinicAdapter } from "./adapter";
import { DemoAdapter } from "./demoAdapter";
import { SupabaseAdapter } from "./supabaseAdapter";

let cached: ClinicAdapter | null = null;

/** Supabase when both public env vars were set at build time, otherwise the sandbox demo. */
export function getAdapter(): ClinicAdapter {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key) {
    cached = new SupabaseAdapter(url, key);
  } else {
    let store: Storage | undefined;
    try { store = typeof window !== "undefined" ? window.localStorage : undefined; } catch { store = undefined; }
    cached = new DemoAdapter(store);
  }
  return cached;
}
