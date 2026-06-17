import { useState, useEffect } from "react";
import { createInvitation } from "@/services/api";

interface Props {
  onClose: () => void;
}

export default function InviteDriverModal({ onClose }: Props) {
  const [loading, setLoading]   = useState(false);
  const [link, setLink]         = useState("");
  const [error, setError]       = useState("");
  const [copied, setCopied]     = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleGenerate() {
    setLoading(true);
    setError("");
    try {
      const inv = await createInvitation();
      const url = `${window.location.origin}/unirse?code=${inv.code}`;
      setLink(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al generar el enlace");
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleWhatsApp() {
    const msg = encodeURIComponent(
      `Hola! Te invito a SafeTruck 🚛\n\nRegistrate acá para empezar a recibir viajes:\n${link}\n\nEs rápido y gratis.`
    );
    window.open(`https://wa.me/?text=${msg}`, "_blank");
  }

  return (
    <div
      className="st-modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="st-modal" style={{ maxWidth: 420 }}>
        <h3 style={{ margin: "0 0 6px", fontSize: "1.1rem", fontWeight: 700, color: "#0d0d0d" }}>
          Invitar conductor
        </h3>
        <p style={{ margin: "0 0 24px", fontSize: "0.88rem", color: "#6b7280", lineHeight: 1.5 }}>
          Generá un enlace y mandáselo por WhatsApp. El conductor se registra con sus datos y queda vinculado automáticamente.
        </p>

        {error && (
          <div
            style={{
              background: "var(--c-danger-soft)",
              border: "1px solid var(--c-danger)",
              color: "var(--c-accent-hover)",
              borderRadius: "var(--r-md)",
              padding: "10px 14px",
              fontWeight: 600,
              fontSize: "0.85rem",
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        {!link ? (
          <button
            className="st-btn-cta"
            onClick={handleGenerate}
            disabled={loading}
          >
            {loading ? "Generando enlace…" : "Generar enlace de invitación"}
          </button>
        ) : (
          <>
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: "0.72rem", fontWeight: 700, color: "#6b7280", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
                Enlace de registro
              </p>
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "#fafafa", border: "1px solid #f0f0f0",
                borderRadius: 10, padding: "10px 14px",
              }}>
                <span style={{
                  flex: 1, fontSize: "0.82rem", color: "#6b7280",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {link}
                </span>
                <button
                  className="st-btn-secondary"
                  style={{ padding: "6px 12px", fontSize: "0.78rem", whiteSpace: "nowrap", flexShrink: 0 }}
                  onClick={handleCopy}
                >
                  {copied ? "✓ Copiado" : "Copiar"}
                </button>
              </div>
              <p style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: 6 }}>
                Válido por 7 días · Un solo uso
              </p>
            </div>

            <button
              onClick={handleWhatsApp}
              style={{
                width: "100%", padding: "14px 0", borderRadius: 12,
                background: "#25D366", color: "#fff", border: "none",
                fontFamily: "inherit", fontSize: "1rem", fontWeight: 700,
                cursor: "pointer", display: "flex", alignItems: "center",
                justifyContent: "center", gap: 10, marginBottom: 10,
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
              </svg>
              Enviar por WhatsApp
            </button>

            <button
              className="st-btn-secondary"
              style={{ width: "100%", marginBottom: 10 }}
              onClick={() => { setLink(""); setCopied(false); }}
            >
              Generar otro enlace
            </button>
          </>
        )}

        <button className="st-btn-secondary" style={{ width: "100%" }} onClick={onClose}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
