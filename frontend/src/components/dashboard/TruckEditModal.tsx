import { useState, useEffect } from "react";
import type { Truck } from "@/types/auth";
import { createTruck, updateTruck, deleteTruck, SubscriptionRequiredError } from "@/services/api";
import { Icons } from "./DashboardIcons";

interface Props {
  truck: Truck | null;
  onSave: () => void;
  onClose: () => void;
  onSubscriptionRequired?: () => void;
}

interface DraftTruck {
  name: string;
  patente: string;
  modelo: string;
  anio: string;
  km_actual: string;
  max_weight_kg: string;
  max_height_m: string;
  max_width_m: string;
  max_length_m: string;
  fecha_service: string;
  proximo_service: string;
}

const EMPTY_DRAFT: DraftTruck = {
  name:           "",
  patente:        "",
  modelo:         "",
  anio:           "",
  km_actual:      "",
  max_weight_kg:  "",
  max_height_m:   "",
  max_width_m:    "",
  max_length_m:   "",
  fecha_service:  "",
  proximo_service:"",
};

function fromTruck(t: Truck): DraftTruck {
  return {
    name:           t.name,
    patente:        t.patente ?? "",
    modelo:         t.modelo ?? "",
    anio:           t.anio != null ? String(t.anio) : "",
    km_actual:      t.km_actual != null ? String(t.km_actual) : "",
    max_weight_kg:  String(t.max_weight_kg),
    max_height_m:   String(t.max_height_m),
    max_width_m:    String(t.max_width_m),
    max_length_m:   String(t.max_length_m),
    fecha_service:  t.fecha_service ?? "",
    proximo_service:t.proximo_service ?? "",
  };
}

function parseNumberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sanitizePatente(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
  let out = "";
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const isLetter = /[A-Z]/.test(ch);
    const isDigit = /[0-9]/.test(ch);
    if (i < 2 && !isLetter) break;
    if (i >= 2 && i < 5 && !isDigit) break;
    if (i >= 5 && !isLetter) break;
    out += ch;
  }
  if (out.length > 5) return `${out.slice(0, 2)}-${out.slice(2, 5)}-${out.slice(5)}`;
  if (out.length > 2) return `${out.slice(0, 2)}-${out.slice(2)}`;
  return out;
}

const onlyDigits = (s: string, max?: number) => {
  const d = s.replace(/[^0-9]/g, "");
  return max ? d.slice(0, max) : d;
};

const onlyDecimal = (s: string) => {
  const clean = s.replace(/,/g, ".").replace(/[^0-9.]/g, "");
  const [int, ...rest] = clean.split(".");
  return rest.length === 0 ? int : `${int}.${rest.join("")}`;
};

type BuildResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

function buildPayload(draft: DraftTruck): BuildResult {
  const modelo = draft.modelo.trim();
  if (!modelo) return { ok: false, error: "El modelo es requerido." };

  const max_weight_kg = parseNumberOrNull(draft.max_weight_kg);
  const max_height_m  = parseNumberOrNull(draft.max_height_m);
  const max_width_m   = parseNumberOrNull(draft.max_width_m);
  const max_length_m  = parseNumberOrNull(draft.max_length_m);

  if (
    max_weight_kg === null ||
    max_height_m === null ||
    max_width_m === null ||
    max_length_m === null
  ) {
    return { ok: false, error: "Las dimensiones (peso, alto, ancho, largo) son requeridas." };
  }


  return {
    ok: true,
    data: {
      name:            modelo,
      patente:         draft.patente.trim() || null,
      modelo,
      anio:            parseNumberOrNull(draft.anio),
      km_actual:       parseNumberOrNull(draft.km_actual),
      max_weight_kg,
      max_height_m,
      max_width_m,
      max_length_m,
      fecha_service:   draft.fecha_service || null,
      proximo_service: draft.proximo_service || null,
    },
  };
}

export default function TruckEditModal({ truck, onSave, onClose, onSubscriptionRequired }: Props) {
  const [draft, setDraft] = useState<DraftTruck>(() =>
    truck ? fromTruck(truck) : EMPTY_DRAFT,
  );
  const [error, setError] = useState("");
  const [subscriptionError, setSubscriptionError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isEdit = truck !== null;
  const title = isEdit ? "Editar camión" : "Nuevo camión";
  const today = new Date().toISOString().slice(0, 10);

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
    if (!truck) return;
    setDeleting(true);
    setError("");
    try {
      await deleteTruck(truck.id);
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al eliminar el camión.");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const update =
    (k: keyof DraftTruck) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setDraft((d) => ({ ...d, [k]: e.target.value }));

  const updateMasked =
    (k: keyof DraftTruck, mask: (s: string) => string) =>
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
    setSubscriptionError(false);
    setSaving(true);
    try {
      if (isEdit && truck) {
        await updateTruck(truck.id, result.data as Partial<Truck>);
      } else {
        await createTruck(result.data as Partial<Truck>);
      }
      onSave();
    } catch (err) {
      if (err instanceof SubscriptionRequiredError) {
        setSubscriptionError(true);
      } else {
        setError(err instanceof Error ? err.message : "Error al guardar el camión.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="st-modal-backdrop" onClick={onClose}>
      <form
        className="st-modal"
        style={{ maxWidth: 720 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <ModalHeader title={title} onClose={onClose} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Modelo" required>
              <input
                className="st-field"
                value={draft.modelo}
                onChange={update("modelo")}
                placeholder="Iveco Tector"
                autoFocus
              />
            </Field>
            <Field label="Patente">
              <input
                className="st-field"
                value={draft.patente}
                onChange={updateMasked("patente", sanitizePatente)}
                placeholder="AC-742-PT"
                maxLength={9}
                inputMode="text"
                autoCapitalize="characters"
              />
            </Field>
            <Field label="Año">
              <input
                className="st-field"
                type="text"
                inputMode="numeric"
                value={draft.anio}
                onChange={updateMasked("anio", (s) => onlyDigits(s, 4))}
                placeholder="2022"
                maxLength={4}
              />
            </Field>
            <Field label="Km actuales">
              <input
                className="st-field"
                type="text"
                inputMode="numeric"
                value={draft.km_actual}
                onChange={updateMasked("km_actual", (s) => onlyDigits(s, 7))}
                placeholder="125000"
              />
            </Field>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Peso máx (kg)" required>
              <input
                className="st-field"
                type="text"
                inputMode="decimal"
                value={draft.max_weight_kg}
                onChange={updateMasked("max_weight_kg", onlyDecimal)}
                placeholder="15000"
              />
            </Field>
            <Field label="Alto máx (m)" required hint="Máx. 4.0 m">
              <input
                className="st-field"
                type="text"
                inputMode="decimal"
                value={draft.max_height_m}
                onChange={updateMasked("max_height_m", onlyDecimal)}
                placeholder="4.0"
              />
            </Field>
            <Field label="Ancho máx (m)" required>
              <input
                className="st-field"
                type="text"
                inputMode="decimal"
                value={draft.max_width_m}
                onChange={updateMasked("max_width_m", onlyDecimal)}
                placeholder="2.5"
              />
            </Field>
            <Field label="Largo máx (m)" required>
              <input
                className="st-field"
                type="text"
                inputMode="decimal"
                value={draft.max_length_m}
                onChange={updateMasked("max_length_m", onlyDecimal)}
                placeholder="8.0"
              />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Último service">
                <input
                  className="st-field"
                  type="date"
                  value={draft.fecha_service}
                  onChange={update("fecha_service")}
                  max={today}
                />
              </Field>
              <Field label="Próximo service">
                <input
                  className="st-field"
                  type="date"
                  value={draft.proximo_service}
                  onChange={update("proximo_service")}
                  min={today}
                />
              </Field>
            </div>
          </div>
        </div>

        {subscriptionError && (
          <div style={{
            background: "rgba(229,57,53,0.06)", border: "1px solid rgba(229,57,53,0.2)",
            borderRadius: 10, padding: "14px 16px", marginTop: 14,
            display: "flex", flexDirection: "column", gap: 10,
          }}>
            <div>
              <p style={{ color: "#c62828", fontWeight: 700, fontSize: "0.88rem", margin: "0 0 4px" }}>
                Necesitás una suscripción activa
              </p>
              <p style={{ color: "#6b7280", fontSize: "0.82rem", margin: 0, lineHeight: 1.45 }}>
                Para agregar camiones debés tener un plan activo.
              </p>
            </div>
            {onSubscriptionRequired && (
              <button
                type="button"
                onClick={onSubscriptionRequired}
                style={{
                  alignSelf: "flex-start", background: "#e53935", color: "#fff",
                  border: "none", borderRadius: 8, padding: "8px 16px",
                  fontSize: "0.82rem", fontWeight: 700, cursor: "pointer",
                }}
              >
                Ver planes y precios
              </button>
            )}
          </div>
        )}

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
              Eliminar camión
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
              {saving ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear camión"}
            </button>
          </div>
        </div>
      </form>

      {confirmDelete && truck && (
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
              ¿Eliminar este camión?
            </h3>
            <p style={{ color: "#4b5563", fontSize: "0.9rem", margin: "0 0 18px" }}>
              Estás por eliminar <strong>{truck.modelo ?? truck.name}</strong>
              {truck.patente ? ` (${truck.patente})` : ""}. Esta acción no se puede deshacer.
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
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="st-label" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{label}{required && <span style={{ color: "var(--c-accent)" }}>*</span>}</span>
        {hint && <span style={{ color: "#9ca3af", fontWeight: 400, fontSize: "0.75rem" }}>{hint}</span>}
      </label>
      {children}
    </div>
  );
}
