import { useState } from "react";
import type { Truck, Driver } from "@/types/auth";
import { assignDriver, unassignDriver } from "@/services/api";
import { Icons } from "./DashboardIcons";

const DRIVER_ESTADO_ACTIVO = "Activo";

interface Props {
  truck: Truck;
  drivers: Driver[];
  onDone: () => void;
  onClose: () => void;
}

export default function AssignDriverModal({ truck, drivers, onDone, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const activeDrivers = drivers.filter((d) => d.estado === DRIVER_ESTADO_ACTIVO);
  const currentDriverId = truck.driver?.id ?? null;

  async function handleAssign(driverId: number) {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await assignDriver(truck.id, driverId);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al asignar el conductor.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnassign() {
    if (busy || currentDriverId === null) return;
    setError("");
    setBusy(true);
    try {
      await unassignDriver(truck.id);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al quitar la asignación.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="st-modal-backdrop" onClick={onClose}>
      <form
        className="st-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => e.preventDefault()}
      >
        <ModalHeader title={`Asignar conductor — ${truck.name}`} onClose={onClose} />

        {activeDrivers.length === 0 ? (
          <p style={{ color: "#6b7280", fontSize: "0.9rem", margin: 0 }}>
            No hay conductores activos. Agregá uno desde la pestaña Conductores.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {activeDrivers.map((d) => {
              const isCurrent = d.id === currentDriverId;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    disabled={busy || isCurrent}
                    onClick={() => handleAssign(d.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "12px 14px",
                      borderRadius: 10,
                      border: `1px solid ${isCurrent ? "#e53935" : "#e0e0e0"}`,
                      background: isCurrent ? "rgba(229,57,53,0.05)" : "#fff",
                      cursor: busy || isCurrent ? "default" : "pointer",
                      fontFamily: "inherit",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, color: "#0d0d0d" }}>{d.nombre}</div>
                      <div style={{ fontSize: "0.82rem", color: "#6b7280" }}>
                        {d.telefono ?? "—"}
                        {d.licencia ? ` · ${d.licencia}` : ""}
                      </div>
                    </div>
                    {isCurrent && (
                      <span
                        style={{
                          fontSize: "0.72rem",
                          fontWeight: 700,
                          color: "#e53935",
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                        }}
                      >
                        Asignado
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {error && (
          <p style={{ color: "#c62828", fontWeight: 600, fontSize: "0.85rem", margin: "14px 0 0" }}>
            {error}
          </p>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginTop: 18,
          }}
        >
          {currentDriverId !== null ? (
            <button
              type="button"
              className="st-btn-secondary"
              onClick={handleUnassign}
              disabled={busy}
            >
              Quitar asignación
            </button>
          ) : <span />}
          <button type="button" className="st-btn-secondary" onClick={onClose} disabled={busy}>
            Cerrar
          </button>
        </div>
      </form>
    </div>
  );
}

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 18,
      }}
    >
      <h3 style={{ fontSize: "1.1rem", fontWeight: 800, color: "#0d0d0d", margin: 0 }}>
        {title}
      </h3>
      <button
        type="button"
        onClick={onClose}
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "#6b7280",
          width: 32,
          height: 32,
          borderRadius: 8,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icons.Close />
      </button>
    </div>
  );
}
