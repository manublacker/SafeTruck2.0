import { useState, useEffect } from "react";
import { getToken } from "@/services/api";

interface Template {
  key: "standard" | "heavy" | "trailer";
  name: string;
  emoji: string;
  specs: string;
  sub: string;
}

const TEMPLATES: Template[] = [
  {
    key: "standard",
    name: "Estándar",
    emoji: "🚛",
    specs: "20 tn · 4.0 m alt · 2.55 m ancho · 12 m largo",
    sub: "Camión rígido urbano",
  },
  {
    key: "heavy",
    name: "Pesado",
    emoji: "🚚",
    specs: "40 tn · 4.0 m alt · 2.6 m ancho · 18 m largo",
    sub: "Camión de larga distancia",
  },
  {
    key: "trailer",
    name: "Remolque",
    emoji: "🚜",
    specs: "32 tn · 4.0 m alt · 2.55 m ancho · 20 m largo",
    sub: "Semi-remolque o acoplado",
  },
];

interface Props {
  onSaved: () => void;
  onClose: () => void;
}

const BASE_URL = import.meta.env.VITE_API_URL ?? "";

export default function TruckTemplateModal({ onSaved, onClose }: Props) {
  const [selected, setSelected] = useState<Template["key"]>("standard");
  const [prefix, setPrefix]     = useState("");
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleCreate() {
    if (!prefix.trim()) { setError("Ingresá un nombre base"); return; }
    setLoading(true);
    setError("");
    try {
      const token = getToken();
      const res = await fetch(`${BASE_URL}/api/trucks/bulk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ template: selected, quantity, name_prefix: prefix.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear los camiones");
    } finally {
      setLoading(false);
    }
  }

  const selectedTpl = TEMPLATES.find((t) => t.key === selected)!;

  return (
    <div className="st-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="st-modal" style={{ maxWidth: 480 }}>
        <h3 style={{ margin: "0 0 6px", fontSize: "1.05rem", fontWeight: 700, color: "#0d0d0d" }}>
          Agregar camiones desde plantilla
        </h3>
        <p style={{ margin: "0 0 20px", fontSize: "0.82rem", color: "#6b7280" }}>
          Elegí un tipo, poné un nombre base y la cantidad.
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

        {/* Template selector */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          {TEMPLATES.map((t) => {
            const active = selected === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setSelected(t.key)}
                style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "14px 16px", borderRadius: 12, cursor: "pointer",
                  border: `1.5px solid ${active ? "#e53935" : "#f0f0f0"}`,
                  background: active ? "rgba(229,57,53,0.04)" : "#fff",
                  textAlign: "left", fontFamily: "inherit", transition: "border-color .15s, background .15s",
                }}
              >
                <span style={{ fontSize: "1.6rem", lineHeight: 1 }}>{t.emoji}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: "0.92rem", color: "#0d0d0d" }}>{t.name}</div>
                  <div style={{ fontSize: "0.78rem", color: "#6b7280", marginTop: 1 }}>{t.sub}</div>
                  <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
                    {t.specs}
                  </div>
                </div>
                {active && (
                  <div style={{
                    width: 18, height: 18, borderRadius: 999,
                    background: "#e53935", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Name + quantity */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginBottom: 20 }}>
          <div>
            <label className="st-label">Nombre base</label>
            <input
              className="st-field"
              placeholder={`Ej: ${selectedTpl.name} Norte`}
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
            />
          </div>
          <div>
            <label className="st-label">Cantidad</label>
            <div style={{ display: "flex", alignItems: "center", gap: 0, height: 44 }}>
              <button
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                style={{
                  width: 36, height: 44, border: "1.5px solid #e0e0e0", borderRight: "none",
                  borderRadius: "10px 0 0 10px", background: "#fff", cursor: "pointer",
                  fontSize: "1.1rem", fontWeight: 700, color: "#0d0d0d", display: "flex",
                  alignItems: "center", justifyContent: "center",
                }}
              >−</button>
              <div style={{
                width: 44, height: 44, border: "1.5px solid #e0e0e0",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 800, fontSize: "1rem", color: "#0d0d0d", background: "#fafafa",
              }}>
                {quantity}
              </div>
              <button
                onClick={() => setQuantity((q) => Math.min(10, q + 1))}
                style={{
                  width: 36, height: 44, border: "1.5px solid #e0e0e0", borderLeft: "none",
                  borderRadius: "0 10px 10px 0", background: "#fff", cursor: "pointer",
                  fontSize: "1.1rem", fontWeight: 700, color: "#0d0d0d", display: "flex",
                  alignItems: "center", justifyContent: "center",
                }}
              >+</button>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="st-btn-cta" style={{ flex: 1 }} onClick={handleCreate} disabled={loading}>
            {loading ? "Creando…" : `Crear ${quantity} camión${quantity !== 1 ? "es" : ""}`}
          </button>
          <button className="st-btn-secondary" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
