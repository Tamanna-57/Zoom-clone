"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

type ToastKind = "info" | "success" | "error";

interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
}

const ToastContext = createContext<{ notify: (t: Omit<Toast, "id">) => void } | null>(null);

const ICON: Record<ToastKind, string> = { info: "ⓘ", success: "✓", error: "!" };
const TONE: Record<ToastKind, string> = {
  info: "border-zoom-blue/40 bg-zoom-blue/10 text-zoom-blue",
  success: "border-zoom-green/40 bg-zoom-green/10 text-zoom-green",
  error: "border-zoom-red/40 bg-zoom-red/10 text-zoom-red",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((toast: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 4200);
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-6 right-6 z-[100] flex w-80 flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className="animate-slide-in pointer-events-auto rounded-xl border border-line bg-surface p-3 shadow-xl shadow-black/10"
          >
            <div className="flex items-start gap-3">
              <span
                className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-bold ${TONE[toast.kind]}`}
              >
                {ICON[toast.kind]}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-body">{toast.title}</p>
                {toast.detail && <p className="mt-0.5 text-xs text-muted">{toast.detail}</p>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>");
  return context;
}
