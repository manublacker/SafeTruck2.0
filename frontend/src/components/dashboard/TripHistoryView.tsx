import { useState, useMemo } from "react";
import { TRIPS } from "./mockData";
import { Icons } from "./DashboardIcons";
import { useAuth } from "@/contexts/AuthContext";

function badgeClass(status: string) {
  if (status === "En curso")   return "st-badge st-badge-encurso";
  if (status === "Completado") return "st-badge st-badge-completado";
  return "st-badge st-badge-cancelado";
}

export default function TripHistoryView() {
  const { drivers } = useAuth();
  const [filterDriver, setFilterDriver] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to,   setTo]   = useState("");

  const reset = () => { setFilterDriver(""); setFilterStatus(""); setFrom(""); setTo(""); };

  const filtered = useMemo(() =>
    TRIPS.filter((t) => {
      if (filterDriver && t.driver !== filterDriver) return false;
      if (filterStatus && t.status !== filterStatus) return false;
      return true;
    }),
    [filterDriver, filterStatus]
  );

  return (
    <div style={{ padding: 24, height: "100%", background: "#fff", overflowY: "auto" }}>
      <div style={{ marginBottom: 20 }}>
        <div className="st-section-eyebrow">Operaciones</div>
        <h2 className="st-section-title">Historial de viajes</h2>
      </div>

      {/* Filtros */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ minWidth: 200 }}>
          <label className="st-label">Conductor</label>
          <select
            className={`st-select${!filterDriver ? " placeholder" : ""}`}
            value={filterDriver}
            onChange={(e) => setFilterDriver(e.target.value)}
          >
            <option value="">Todos los conductores</option>
            {drivers.map((d) => <option key={d.id} value={d.nombre}>{d.nombre}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 180 }}>
          <label className="st-label">Estado</label>
          <select
            className={`st-select${!filterStatus ? " placeholder" : ""}`}
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">Todos los estados</option>
            <option value="Completado">Completado</option>
            <option value="En curso">En curso</option>
            <option value="Cancelado">Cancelado</option>
          </select>
        </div>
        <div style={{ minWidth: 160 }}>
          <label className="st-label">Desde</label>
          <input type="date" className="st-input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div style={{ minWidth: 160 }}>
          <label className="st-label">Hasta</label>
          <input type="date" className="st-input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button
          onClick={reset}
          style={{
            background: "transparent", border: "none", color: "#e53935",
            fontSize: "0.82rem", fontWeight: 700, cursor: "pointer",
            padding: "14px 4px", fontFamily: "inherit",
          }}
        >
          Restablecer
        </button>
      </div>

      <table className="st-table">
        <thead>
          <tr>
            <th>Origen → Destino</th>
            <th>Conductor</th>
            <th>Camión</th>
            <th>Fecha</th>
            <th>Duración</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((t) => (
            <tr key={t.id}>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                  <span>{t.from}</span>
                  <span style={{ color: "#e53935" }}><Icons.Arrow /></span>
                  <span>{t.to}</span>
                </div>
              </td>
              <td style={{ color: "#0d0d0d" }}>{t.driver}</td>
              <td style={{ fontVariantNumeric: "tabular-nums", color: "#6b7280" }}>{t.truck}</td>
              <td style={{ color: "#6b7280" }}>{t.date}</td>
              <td style={{ fontVariantNumeric: "tabular-nums", color: "#6b7280" }}>{t.duration}</td>
              <td><span className={badgeClass(t.status)}>{t.status}</span></td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={6} style={{ textAlign: "center", color: "#9ca3af", padding: 32 }}>
                No hay viajes que coincidan con los filtros.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
