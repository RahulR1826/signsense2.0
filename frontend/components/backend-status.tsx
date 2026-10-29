"use client";

import { useEffect, useState } from "react";

import { API_URL } from "@/lib/api";

type Status = "checking" | "ok" | "down";

async function check(path: string): Promise<Status> {
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
    return res.ok ? "ok" : "down";
  } catch {
    return "down";
  }
}

const label: Record<Status, string> = { checking: "checking…", ok: "connected", down: "not reachable" };
const color: Record<Status, string> = { checking: "bg-muted-foreground", ok: "bg-green-600", down: "bg-red-600" };

export function BackendStatus() {
  const [api, setApi] = useState<Status>("checking");
  const [db, setDb] = useState<Status>("checking");

  useEffect(() => {
    check("/api/health").then(setApi);
    check("/api/health/db").then(setDb);
  }, []);

  return (
    <ul className="space-y-1 text-sm text-muted-foreground">
      {([["Backend", api], ["Database", db]] as const).map(([name, status]) => (
        <li key={name} className="flex items-center gap-2">
          <span className={`size-2 rounded-full ${color[status]}`} aria-hidden />
          {name}: {label[status]}
        </li>
      ))}
    </ul>
  );
}
