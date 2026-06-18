import { useState, useEffect } from "react";
import type { Driver } from "@/types/auth";
import { createDriver, updateDriver, deleteDriver } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Icons } from "./DashboardIcons";

const DRIVER_ESTADOS = ["Activo", "De licencia", "Inactivo"] as const;
type DriverEstado = (typeof DRIVER_ESTADOS)[number];

function sanitizeTelefono(raw: string): string {
  const hasPlus = raw.trim().startsWith("+");
  const digits = raw.replace(/\D/g, "").slice(0, 15);
  return hasPlus ? `+${digits}` : digits;
}

interface Props {
  driver: Driver | null;
  onSave: () => void;
  onClose: () => void;
}

interface DraftDriver {
  nombre: string;
  telefono: string;
  estado: DriverEstado;
}

const EMPTY_DRAFT: DraftDriver = {
  nombre:   "",
  telefono: "",
  estado:   "Activo",
};

function fromDriver(d: Driver): DraftDriver {
  return {
    nombre:   d.nombre,
    telefono: d.telefono ?? "",
    estado: (DRIVER_ESTADOS as readonly string[]).includes(d.estado)
      ? (d.estado as DriverEstado)
      : "Activo",
  };
}

type BuildResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

function buildPayload(draft: DraftDriver): BuildResult {
  const nombre = draft.nombre.trim();
  if (!nombre) return { ok: false, error: "El nombre es requerido." };

  return {
    ok: true,
    data: {
      nombre,
      telefono: draft.telefono.trim() || null,
      estado:   draft.estado,
    },
  };
}

export default function DriverEditModal({ driver, onSave, onClose }: Props) {
  const { refreshDrivers } = useAuth();
  const [draft, setDraft] = useState<DraftDriver>(() =>
    driver ? fromDriver(driver) : EMPTY_DRAFT,
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isEdit = driver !== null;
  const title = isEdit ? "Editar conductor" : "Nuevo conductor";

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (confirmDelete) setConfirmDelete(false);
      else onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDelete, onClose]);

  async function handleDelete() {
    if (!driver) return;
    setDeleting(true);
    setError("");
    try {
      await deleteDriver(driver.id);
      await refreshDrivers();
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al eliminar el conductor.");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const update =
    (k: keyof DraftDriver) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setDraft((d) => ({ ...d, [k]: e.target.value }));

  const updateMasked =
    (k: keyof DraftDriver, mask: (s: string) => string) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setDraft((d) => ({ ...d, [k]: mask(e.target.value) }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;

    const result = buildPayload(draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setError("");
    setSaving(true);
    try {
      if (isEdit && driver) {
        await updateDriver(driver.id, result.data as Partial<Driver>);
      } else {
        await createDriver(result.data as Partial<Driver>);
      }
      await refreshDrivers();
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar el conductor.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="st-modal-backdrop" onClick={onClose}>
      <form
        className="st-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <ModalHeader title={title} onClose={onClose} />

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Nombre" required>
            <input
              className="st-field"
              value={draft.nombre}
              onChange={update("nombre")}
              placeholder="Ej. Juan Pérez"
              autoFocus
            />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Teléfono">
              <input
                className="st-field"
                type="tel"
                inputMode="tel"
                value={draft.telefono}
                onChange={updateMasked("telefono", sanitizeTelefono)}
                placeholder="+541112345678"
                maxLength={16}
              />
            </Field>
            <Field label="Estado">
              <select
                className="st-field"
                value={draft.estado}
                onChange={update("estado")}
              >
                {DRIVER_ESTADOS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>
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
              marginTop: 14,
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: isEdit ? "space-between" : "flex-end",
            gap: 12,
            marginTop: 22,
          }}
        >
          {isEdit && (
            <button
              type="button"
              className="st-btn-danger"
              onClick={() => setConfirmDelete(true)}
              disabled={saving || deleting}
            >
              Eliminar conductor
            </button>
          )}
          <div style={{ display: "flex", gap: 12 }}>
            <button type="button" className="st-btn-secondary" onClick={onClose} disabled={saving || deleting}>
              Cancelar
            </button>
            <button
              type="submit"
              className="st-btn-cta"
              disabled={saving || deleting}
            >
              {saving ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear conductor"}
            </button>
          </div>
        </div>
      </form>

      {confirmDelete && driver && (
        <div
          className="st-modal-backdrop"
          onClick={() => !deleting && setConfirmDelete(false)}
          style={{ zIndex: 1000 }}
        >
          <div
            className="st-modal"
            style={{ maxWidth: 420 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 10px" }}>
              ¿Eliminar este conductor?
            </h3>
            <p style={{ color: "#4b5563", fontSize: "0.9rem", margin: "0 0 18px" }}>
              Estás por eliminar a <strong>{driver.nombre}</strong>. Esta acción no se puede deshacer.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                type="button"
                className="st-btn-secondary"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="st-btn-danger solid"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Eliminando…" : "Sí, eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Subcomponentes ─────────────────────────────────────────────────────────

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
      <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#0d0d0d", margin: 0 }}>
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

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="st-label">
        {label}
        {required && <span style={{ color: "var(--c-accent)" }}>*</span>}
      </label>
      {children}
    </div>
  );
}
