"use client";

import { AlertCircle, Check, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

type Tone = "success" | "error" | "info";

interface Toast {
  id: number;
  tone: Tone;
  title: string;
  description?: string;
}

interface ToastApi {
  toast: (t: { tone?: Tone; title: string; description?: string }) => void;
}

const ToastContext = createContext<ToastApi>({ toast: () => undefined });

/** Short confirmations of things that really happened (link copied, settings saved, a request failed). */
export function useToast() {
  return useContext(ToastContext);
}

const TONE: Record<Tone, { Icon: typeof Check; cls: string; label: string }> = {
  success: { Icon: Check, cls: "bg-success-soft text-success", label: "Done" },
  error: { Icon: AlertCircle, cls: "bg-destructive/10 text-destructive", label: "Problem" },
  info: { Icon: Info, cls: "bg-brand-soft text-brand", label: "Note" },
};

export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback<ToastApi["toast"]>(
    ({ tone = "success", title, description }) => {
      const id = next.current++;
      setToasts((t) => [...t.slice(-2), { id, tone, title, description }]);
      setTimeout(() => dismiss(id), tone === "error" ? 6000 : 3500);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Polite live region: screen readers announce each toast once. */}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
        {toasts.map(({ id, tone, title, description }) => {
          const { Icon, cls, label } = TONE[tone];
          return (
            <div
              key={id}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border bg-card p-3 pr-2 text-card-foreground shadow-[var(--shadow-lift)] [animation:toast-in_0.35s_var(--ease-out-soft)_both]"
            >
              <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${cls}`}>
                <Icon className="size-4" aria-hidden />
                <span className="sr-only">{label}:</span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{title}</p>
                {description && <p className="text-sm text-muted-foreground">{description}</p>}
              </div>
              <button type="button" onClick={() => dismiss(id)} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted" aria-label="Dismiss">
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
