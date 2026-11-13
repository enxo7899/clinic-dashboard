"use client";
import { useEffect, useState } from "react";
import { useClinic } from "./ClinicProvider";
import type { Chair, Patient, Staff, Treatment } from "../lib/types";

export interface RefData {
  staff: Staff[];
  providers: Staff[];
  treatments: Treatment[];
  chairs: Chair[];
  patients: Patient[];
  loaded: boolean;
}

/** Reference lists the screens need, filtered by what the signed-in role may see. */
export function useRefData(): RefData {
  const { adapter, actor, rev } = useClinic();
  const [d, setD] = useState<RefData>({ staff: [], providers: [], treatments: [], chairs: [], patients: [], loaded: false });
  useEffect(() => {
    if (!actor) return;
    let live = true;
    (async () => {
      const [s, t, c, p] = await Promise.all([adapter.listStaff(actor), adapter.listTreatments(), adapter.listChairs(), adapter.listPatients(actor)]);
      if (!live) return;
      const staff = s.ok ? s.value : [];
      setD({
        staff,
        providers: staff.filter((x) => x.role === "dentist" && x.active && (actor.role !== "dentist" || x.id === actor.id)),
        treatments: t,
        chairs: c,
        patients: p.ok ? p.value : [],
        loaded: true,
      });
    })();
    return () => { live = false; };
  }, [adapter, actor, rev]);
  return d;
}

export const aed = (n: number) => `${n.toLocaleString("en-GB").replace(/,/g, " ")} ALL`;
