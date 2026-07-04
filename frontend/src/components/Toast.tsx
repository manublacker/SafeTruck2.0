import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

// Sistema de notificaciones in-app (toasts) para reemplazar los alert() bloqueantes.
// Uso: const { showToast } = useToast();  showToast("Guardado", "success");

type ToastType = "success" | "error" | "info";
interface ToastItem { id: number; message: string; type: ToastType; leaving?: boolean; }

interface ToastApi { showToast: (message: string, type?: ToastType) => void; }

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast debe usarse dentro de <ToastProvider>.");
  return ctx;
}

const COLORS: Record<ToastType, { bg: string; bar: string; text?: string }> = {
  success: { bg: "#DCFCE7", bar: "#DCFCE7", text: "#14532D" },
  error:   { bg: "#5c1a1a", bar: "#FF3B30" },
  info:    { bg: "#1e293b", bar: "#3b82f6" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  // Dos fases: primero se marca "leaving" para que corra la animación de
  // salida, y recién después se saca del array. Si se filtrara directo acá,
  // el cartel desaparecería de golpe sin transición.
  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 180);
  }, []);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => dismiss(id), 4000);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <style>{`
        @keyframes st-toast-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
        @keyframes st-toast-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(-8px)}}
      `}</style>
      <div
        style={{
          position: "fixed", top: 16, right: 16, zIndex: 9999,
          display: "flex", flexDirection: "column", gap: 8, maxWidth: 360,
        }}
      >
        {toasts.map((t) => {
          const c = COLORS[t.type];
          return (
            <div
              key={t.id}
              role="status"
              onClick={() => dismiss(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                background: c.bg, color: c.text ?? "#fff", padding: "12px 14px",
                borderRadius: 10, boxShadow: "0 6px 24px rgba(0,0,0,0.25)",
                borderLeft: `4px solid ${c.bar}`, fontSize: 14, lineHeight: 1.35,
                cursor: "pointer",
                animation: t.leaving ? "st-toast-out .18s ease forwards" : "st-toast-in .2s ease",
              }}
            >
              <span>{t.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
