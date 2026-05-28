import { useState } from "react";
import { createInvitation, type DriverInvitation } from "@/services/api";
import type { Driver } from "@/types/auth";

interface Props {
  driver: Driver;
  onClose: () => void;
}

export default function InviteDriverModal({ driver, onClose }: Props) {
  const [loading, setLoading]   = useState(false);
  const [invitation, setInvitation] = useState<DriverInvitation | null>(null);
  const [error, setError]       = useState("");

  async function handleGenerate() {
    setLoading(true);
    setError("");
    try {
      const inv = await createInvitation(driver.id);
      setInvitation(inv);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al generar el código");
    } finally {
      setLoading(false);
    }
  }

  function handleWhatsApp() {
    if (!invitation) return;
    const expiresDate = new Date(invitation.expires_at).toLocaleDateString("es-AR", {
      day: "2-digit", month: "2-digit", year: "numeric",
    });
    const msg = encodeURIComponent(
      `Hola ${driver.nombre}! Te invito a SafeTruck 🚛\n\n` +
      `Tu código de acceso es: *${invitation.code}*\n\n` +
      `Válido hasta el ${expiresDate}.\n\n` +
      `Descargá la app SafeTruck, creá tu cuenta e ingresá el código en tu perfil para recibir viajes asignados.`
    );
    window.open(`https://wa.me/?text=${msg}`, "_blank");
  }

  function copyCode() {
    if (!invitation) return;
    navigator.clipboard.writeText(invitation.code).catch(() => null);
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 900,
        background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "#fff", borderRadius: 16, padding: 28,
          width: "100%", maxWidth: 420, boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        }}
      >
        <h3 style={{ margin: "0 0 6px", fontSize: "1.1rem", fontWeight: 800, color: "#0d0d0d" }}>
          Invitar conductor
        </h3>
        <p style={{ margin: "0 0 20px", fontSize: "0.88rem", color: "#6b7280" }}>
          Generá un código para que <strong>{driver.nombre}</strong> se vincule a tu empresa en la app SafeTruck.
        </p>

        {error && (
          <p style={{ color: "#c62828", fontSize: "0.85rem", marginBottom: 12 }}>{error}</p>
        )}

        {!invitation ? (
          <button
            className="st-btn-primary"
            style={{ width: "100%" }}
            onClick={handleGenerate}
            disabled={loading}
          >
            {loading ? "Generando…" : "Generar código de invitación"}
          </button>
        ) : (
          <>
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "#6b7280", letterSpacing: 0.6, marginBottom: 8 }}>
                CÓDIGO DE ACCESO
              </p>
              <div
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  background: "#f8f8f8", borderRadius: 12, padding: "12px 16px",
                  border: "1.5px dashed #e53935",
                }}
              >
                <span
                  style={{
                    flex: 1, fontFamily: "ui-monospace, monospace", fontSize: "1.6rem",
                    fontWeight: 800, color: "#e53935", letterSpacing: 4,
                  }}
                >
                  {invitation.code}
                </span>
                <button
                  className="st-btn-secondary"
                  style={{ padding: "6px 12px", fontSize: "0.8rem" }}
                  onClick={copyCode}
                >
                  Copiar
                </button>
              </div>
              <p style={{ fontSize: "0.78rem", color: "#9ca3af", marginTop: 6 }}>
                Válido por 7 días · Un solo uso
              </p>
            </div>

            <button
              style={{
                width: "100%", padding: "12px 0", borderRadius: 10,
                background: "#25D366", color: "#fff", border: "none",
                fontFamily: "inherit", fontSize: "0.95rem", fontWeight: 700,
                cursor: "pointer", display: "flex", alignItems: "center",
                justifyContent: "center", gap: 8,
              }}
              onClick={handleWhatsApp}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
              </svg>
              Enviar por WhatsApp
            </button>

            <button
              className="st-btn-secondary"
              style={{ width: "100%", marginTop: 10 }}
              onClick={handleGenerate}
              disabled={loading}
            >
              Regenerar código
            </button>
          </>
        )}

        <button
          className="st-btn-secondary"
          style={{ width: "100%", marginTop: 10 }}
          onClick={onClose}
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}
