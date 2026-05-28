import { useState } from "react";
import type { Driver } from "@/types/auth";
import { bulkCreateInvitations } from "@/services/api";

interface InvitationResult {
  driver_id: number;
  driver_name: string;
  code: string;
  expires_at: string;
}

interface Props {
  drivers: Driver[];
  onClose: () => void;
}

export default function BulkInviteModal({ drivers, onClose }: Props) {
  const activeDrivers = drivers.filter((d) => d.is_active);
  const [selected, setSelected]   = useState<Set<number>>(new Set(activeDrivers.map((d) => d.id)));
  const [loading, setLoading]     = useState(false);
  const [results, setResults]     = useState<InvitationResult[] | null>(null);
  const [error, setError]         = useState("");

  function toggleAll() {
    if (selected.size === activeDrivers.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(activeDrivers.map((d) => d.id)));
    }
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleGenerate() {
    if (selected.size === 0) return;
    setLoading(true);
    setError("");
    try {
      const data = await bulkCreateInvitations([...selected]);
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
      return `${r.driver_name};${r.code};${exp}`;
    });
    const content = ["Conductor;Código;Vence", ...rows].join("\n");
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "invitaciones_safetruck.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function whatsappUrl(r: InvitationResult) {
    const exp = new Date(r.expires_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
    const msg = encodeURIComponent(
      `Hola ${r.driver_name}! Te invito a SafeTruck 🚛\n\nTu código de acceso es: *${r.code}*\n\nVálido hasta el ${exp}.\n\nDescargá la app SafeTruck, creá tu cuenta e ingresá el código en tu perfil para recibir viajes asignados.`
    );
    return `https://wa.me/?text=${msg}`;
  }

  return (
    <div className="st-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="st-modal" style={{ maxWidth: 560, maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 800, color: "#0d0d0d" }}>
              Invitar conductores en masa
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: "0.82rem", color: "#6b7280" }}>
              Generá códigos de invitación para múltiples conductores a la vez.
            </p>
          </div>
        </div>

        {error && (
          <p style={{ color: "#c62828", fontSize: "0.85rem", marginBottom: 12 }}>{error}</p>
        )}

        {!results ? (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#6b7280" }}>
                {selected.size} de {activeDrivers.length} seleccionados
              </span>
              <button className="st-btn-secondary" style={{ padding: "6px 12px", fontSize: "0.8rem" }} onClick={toggleAll}>
                {selected.size === activeDrivers.length ? "Deseleccionar todos" : "Seleccionar todos"}
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", border: "1px solid #f0f0f0", borderRadius: 10, marginBottom: 16 }}>
              {activeDrivers.length === 0 && (
                <p style={{ padding: 20, color: "#9ca3af", textAlign: "center", fontSize: "0.88rem" }}>
                  No hay conductores activos
                </p>
              )}
              {activeDrivers.map((d) => (
                <label
                  key={d.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "12px 16px", borderBottom: "1px solid #f0f0f0",
                    cursor: "pointer", transition: "background .1s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#fafafa")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(d.id)}
                    onChange={() => toggle(d.id)}
                    style={{ width: 16, height: 16, accentColor: "#e53935", cursor: "pointer" }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "#0d0d0d" }}>{d.nombre}</div>
                    {d.telefono && <div style={{ fontSize: "0.78rem", color: "#6b7280" }}>{d.telefono}</div>}
                  </div>
                </label>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="st-btn-cta"
                style={{ flex: 1 }}
                onClick={handleGenerate}
                disabled={loading || selected.size === 0}
              >
                {loading ? "Generando…" : `Generar ${selected.size} código${selected.size !== 1 ? "s" : ""}`}
              </button>
              <button className="st-btn-secondary" onClick={onClose}>Cancelar</button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: "0.85rem", color: "#16a34a", fontWeight: 700, marginBottom: 12 }}>
              ✓ {results.length} código{results.length !== 1 ? "s" : ""} generado{results.length !== 1 ? "s" : ""} correctamente
            </p>

            <div style={{ flex: 1, overflowY: "auto", border: "1px solid #f0f0f0", borderRadius: 10, marginBottom: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ background: "#fafafa" }}>
                    <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "#6b7280", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #f0f0f0" }}>Conductor</th>
                    <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "#6b7280", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #f0f0f0" }}>Código</th>
                    <th style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "#6b7280", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #f0f0f0" }}>WhatsApp</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.driver_id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "10px 14px", color: "#0d0d0d", fontWeight: 600 }}>{r.driver_name}</td>
                      <td style={{ padding: "10px 14px" }}>
                        <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: "1rem", color: "#e53935", letterSpacing: 2 }}>
                          {r.code}
                        </span>
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "right" }}>
                        <a
                          href={whatsappUrl(r)}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            background: "#25d366", color: "#fff",
                            borderRadius: 7, padding: "5px 10px",
                            fontSize: "0.78rem", fontWeight: 700, textDecoration: "none",
                          }}
                        >
                          WA
                        </a>
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
