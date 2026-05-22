import { useState } from "react";
import { Icons } from "./DashboardIcons";

// Vista legacy: actualmente NO está enlazada al router (la reemplazó FleetView).
// Se mantiene en el repo por requerimiento — no hace fetch real, opera sobre
// un array local vacío para que el archivo compile sin tocar otros consumidores.
const DRIVERS: Driver[] = [];

type Driver = {
  id: string;
  name: string;
  phone: string;
  license: string;
  status: string;
  trip: string;
};

interface DraftDriver {
  name: string; email: string; phone: string; license: string;
}

function initials(name: string) {
  return name.split(" ").map((s) => s[0]).slice(0, 2).join("");
}

export default function DriversView() {
  const [drivers, setDrivers] = useState<Driver[]>(DRIVERS);
  const [open, setOpen]       = useState(false);
  const [draft, setDraft]     = useState<DraftDriver>({ name: "", email: "", phone: "", license: "" });

  const upd = (k: keyof DraftDriver) =>
    (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.name) return;
    setDrivers((ds) => [
      ...ds,
      {
        id: "d" + (ds.length + 1),
        name: draft.name,
        phone: draft.phone || "—",
        license: draft.license || "—",
        status: "Activo",
        trip: "—",
      },
    ]);
    setDraft({ name: "", email: "", phone: "", license: "" });
    setOpen(false);
  };

  const toggleStatus = (id: string) =>
    setDrivers((ds) =>
      ds.map((d) =>
        d.id === id ? { ...d, status: d.status === "Activo" ? "Inactivo" : "Activo" } : d
      )
    );

  return (
    <div style={{ padding: 24, height: "100%", background: "#fff", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div className="st-section-eyebrow">Equipo</div>
          <h2 className="st-section-title">Conductores</h2>
        </div>
        <button className="st-btn-primary" style={{ padding: "12px 18px" }} onClick={() => setOpen(true)}>
          <Icons.Plus size={14} /> Nuevo conductor
        </button>
      </div>

      <table className="st-table">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Teléfono</th>
            <th>Licencia</th>
            <th>Estado</th>
            <th>Viaje actual</th>
            <th style={{ textAlign: "right" }}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {drivers.map((d) => (
            <tr key={d.id}>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 999,
                    background: "#0d0d0d", color: "#fff", fontWeight: 700, fontSize: "0.72rem",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {initials(d.name)}
                  </div>
                  <span style={{ fontWeight: 600 }}>{d.name}</span>
                </div>
              </td>
              <td style={{ fontVariantNumeric: "tabular-nums", color: "#6b7280" }}>{d.phone}</td>
              <td style={{ fontVariantNumeric: "tabular-nums", color: "#6b7280" }}>{d.license}</td>
              <td>
                <span className={`st-badge ${d.status === "Activo" ? "st-badge-activo" : "st-badge-inactivo"}`}>
                  <span className="dot" style={{ background: d.status === "Activo" ? "#22c55e" : "#9ca3af" }} />
                  {d.status}
                </span>
              </td>
              <td style={{ color: d.trip === "—" ? "#9ca3af" : "#0d0d0d" }}>{d.trip}</td>
              <td>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                  <button className="st-action-btn" title="Editar"><Icons.Edit /></button>
                  <button
                    className="st-action-btn danger"
                    title={d.status === "Activo" ? "Desactivar" : "Activar"}
                    onClick={() => toggleStatus(d.id)}
                  >
                    <Icons.Power />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {open && (
        <div className="st-modal-backdrop" onClick={() => setOpen(false)}>
          <form className="st-modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 800, color: "#0d0d0d", margin: 0 }}>Nuevo conductor</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  background: "transparent", border: "none", cursor: "pointer", color: "#6b7280",
                  width: 32, height: 32, borderRadius: 8, display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <Icons.Close />
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label className="st-label">Nombre completo</label>
                <input className="st-input" value={draft.name} onChange={upd("name")} placeholder="Ej. Juan Pérez" autoFocus />
              </div>
              <div>
                <label className="st-label">Email</label>
                <input className="st-input" type="email" value={draft.email} onChange={upd("email")} placeholder="juan@empresa.com" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <label className="st-label">Teléfono</label>
                  <input className="st-input" value={draft.phone} onChange={upd("phone")} placeholder="+54 11 ..." />
                </div>
                <div>
                  <label className="st-label">Número de licencia</label>
                  <input className="st-input" value={draft.license} onChange={upd("license")} placeholder="B-1.234.567" />
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, marginTop: 22 }}>
              <button type="button" className="st-btn-secondary" onClick={() => setOpen(false)}>Cancelar</button>
              <button type="submit" className="st-btn-primary" style={{ padding: "12px 20px" }}>Crear conductor</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
