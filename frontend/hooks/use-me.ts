"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchMe, type User } from "@/lib/auth";

const OFFLINE = "Can't reach the server. Check your connection and reload.";

/** Current user: undefined while loading, null when signed out. */
export function useMe() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetchMe().then(
        (u) => ({ user: u, error: null }),
        () => ({ user: null, error: OFFLINE }),
      ),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    load().then((r) => {
      if (cancelled) return;
      setUser(r.user);
      setError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    const r = await load();
    setUser(r.user);
    setError(r.error);
  }, [load]);

  return { user, setUser, error, refresh };
}
