import { useEffect } from "react";

// Modal de confirmación con el estilo de la app (reemplaza al window.confirm feo
// del browser). Uso: <ConfirmDialog title="..." message="..." destructive
//   onConfirm={...} onCancel={...} />

interface Props {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Pinta el botón de confirmar en rojo (acciones que borran / no se deshacen). */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  destructive = false,
  onConfirm,
  onCancel,
}: Props) {
  // Escape cierra (cancela); bloquea el scroll del fondo mientras está abierto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, onConfirm]);

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(15,27,45,0.45)", backdropFilter: "blur(2px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        animation: "st-confirm-fade .15s ease",
      }}
    >
      <style>{`@keyframes st-confirm-fade{from{opacity:0}to{opacity:1}}
        @keyframes st-confirm-pop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}`}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 420, background: "#fff", borderRadius: 16,
          border: "1px solid #E6E8EC", padding: 26,
          boxShadow: "0 24px 60px -20px rgba(15,27,45,0.45)",
          animation: "st-confirm-pop .18s ease",
        }}
      >
        <h3 style={{ margin: 0, fontSize: 19, fontWeight: 800, letterSpacing: "-0.02em", color: "#16202C" }}>{title}</h3>
        {message && (
          <p style={{ margin: "10px 0 0", fontSize: 15, lineHeight: 1.55, color: "#69727E", whiteSpace: "pre-line" }}>{message}</p>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}>
          <button
            onClick={onCancel}
            style={{
              height: 42, padding: "0 18px", borderRadius: 10, border: "1.5px solid #D6DAE0",
              background: "#fff", color: "#16202C", fontSize: 14, fontWeight: 700, cursor: "pointer",
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              height: 42, padding: "0 18px", borderRadius: 10, border: "none",
              background: destructive ? "#E5342B" : "#16202C", color: "#fff",
              fontSize: 14, fontWeight: 700, cursor: "pointer",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
