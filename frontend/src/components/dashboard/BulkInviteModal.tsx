import { useState, useEffect } from "react";
import { bulkCreateInvitations } from "@/services/api";

interface InvitationResult {
  code: string;
  expires_at: string;
}

interface Props {
  onClose: () => void;
}

export default function BulkInviteModal({ onClose }: Props) {
  const [quantity, setQuantity] = useState(5);
  const [loading, setLoading]   = useState(false);
  const [results, setResults]   = useState<InvitationResult[] | null>(null);
  const [error, setError]       = useState("");

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
      const data = await bulkCreateInvitations(quantity);
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al generar los códigos");
    } finally {
      setLoading(false);
    }
  }

  function downloadCSV() {
    if (!results) return;
    const rows = results.map((r) => {
      const exp = new Date(r.expires_at).toLocaleDateString("es-AR");
      return `${r.code};${exp}`;
    });
    const content = ["Código;Vence", ...rows].join("\n");
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "invitaciones_safetruck.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="st-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="st-modal" style={{ maxWidth: 480, maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 4px", fontSize: "1.05rem", fontWeight: 700, color: "#0d0d0d" }}>
            Invitar en masa
          </h3>
          <p style={{ margin: 0, fontSize: "0.82rem", color: "#6b7280" }}>
            Generá varios códigos a la vez y repartilos entre tus conductores.
          </p>
        </div>

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

        {!results ? (
          <>
            <div style={{ marginBottom: 20 }}>
              <label className="st-label">Cantidad de códigos</label>
              <div style={{ display: "flex", alignItems: "center", gap: 0, height: 44 }}>
                <button
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  style={{
                    width: 44, height: 44, border: "1.5px solid #e0e0e0", borderRight: "none",
                    borderRadius: "10px 0 0 10px", background: "#fff", cursor: "pointer",
                    fontSize: "1.2rem", fontWeight: 700, color: "#0d0d0d",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >−</button>
                <div style={{
                  width: 60, height: 44, border: "1.5px solid #e0e0e0",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 800, fontSize: "1.1rem", color: "#0d0d0d", background: "#fafafa",
                }}>
                  {quantity}
                </div>
                <button
                  onClick={() => setQuantity(q => Math.min(50, q + 1))}
                  style={{
                    width: 44, height: 44, border: "1.5px solid #e0e0e0", borderLeft: "none",
                    borderRadius: "0 10px 10px 0", background: "#fff", cursor: "pointer",
                    fontSize: "1.2rem", fontWeight: 700, color: "#0d0d0d",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >+</button>
              </div>
              <p style={{ margin: "6px 0 0", fontSize: "0.78rem", color: "#9ca3af" }}>
                Máximo 50 códigos por vez. Cada código es de un solo uso.
              </p>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="st-btn-cta" style={{ flex: 1 }} onClick={handleGenerate} disabled={loading}>
                {loading ? "Generando…" : `Generar ${quantity} código${quantity !== 1 ? "s" : ""}`}
              </button>
              <button className="st-btn-secondary" onClick={onClose}>Cancelar</button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: "0.85rem", color: "#16a34a", fontWeight: 700, marginBottom: 12 }}>
              ✓ {results.length} código{results.length !== 1 ? "s" : ""} generado{results.length !== 1 ? "s" : ""}
            </p>

            <div style={{ flex: 1, overflowY: "auto", border: "1px solid #f0f0f0", borderRadius: 10, marginBottom: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ background: "#fafafa" }}>
                    <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "#6b7280", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #f0f0f0" }}>Código</th>
                    <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "#6b7280", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #f0f0f0" }}>Vence</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "10px 14px" }}>
                        <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: "1rem", color: "#e53935", letterSpacing: 2 }}>
                          {r.code}
                        </span>
                      </td>
                      <td style={{ padding: "10px 14px", color: "#6b7280", fontSize: "0.82rem" }}>
                        {new Date(r.expires_at).toLocaleDateString("es-AR")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="st-btn-primary" style={{ flex: 1, padding: "12px 0" }} onClick={downloadCSV}>
                Descargar CSV
              </button>
              <button className="st-btn-secondary" onClick={onClose}>Cerrar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
