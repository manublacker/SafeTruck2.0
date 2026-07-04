import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { calculateRoute, SubscriptionRequiredError } from "@/services/api";
import {
  searchLocations,
  geocodeLocation,
  type GeoSuggestion,
} from "@/services/geocoding";
import type { RouteResponse } from "@/types/route";
import type { Truck } from "@/types/auth";

export interface CalculateResult {
  route: RouteResponse;
  originLabel: string;
  destinationLabel: string;
  originLat: number;
  originLon: number;
  destinationLat: number;
  destinationLon: number;
}

export interface PinPreview {
  lat: number;
  lon: number;
  label: string;
}

export interface RouteCalculatorHandle {
  calculate: () => Promise<CalculateResult | null>;
}

const MIN_QUERY_LENGTH = 3;
const SEARCH_DEBOUNCE_MS = 350;
const MAX_SUGGESTIONS = 6;
const BLUR_CLOSE_DELAY_MS = 150;
const ROUTING_OPTIONS = {
  avoidTolls: true,
  preferHighways: true,
} as const;

interface Field {
  value: string;
  selected: GeoSuggestion | null;
  suggestions: GeoSuggestion[];
  open: boolean;
}

function emptyField(): Field {
  return { value: "", selected: null, suggestions: [], open: false };
}

interface Props {
  selectedTruck: Truck | null;
  onRouteCalculated: (result: RouteResponse) => void;
  onOriginPinned?: (pin: PinPreview | null) => void;
  onDestinationPinned?: (pin: PinPreview | null) => void;
  onSubscriptionRequired?: () => void;
}

const RouteCalculator = forwardRef<RouteCalculatorHandle, Props>(function RouteCalculator(
  { selectedTruck, onRouteCalculated, onOriginPinned, onDestinationPinned, onSubscriptionRequired },
  ref,
) {
  const [origin, setOrigin] = useState<Field>(emptyField());
  const [destination, setDestination] = useState<Field>(emptyField());
  const [error, setError] = useState("");
  const [subscriptionRequired, setSubscriptionRequired] = useState(false);

  const originTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useImperativeHandle(ref, () => ({
    async calculate() {
      if (!selectedTruck) {
        setError("Seleccioná un conductor con camión asignado.");
        return null;
      }
      setError("");
      setSubscriptionRequired(false);
      try {
        const [resolvedOrigin, resolvedDestination] = await Promise.all([
          resolveField(origin, setOrigin),
          resolveField(destination, setDestination),
        ]);

        const response = await calculateRoute({
          originLabel: resolvedOrigin.label,
          destinationLabel: resolvedDestination.label,
          origin: { lat: resolvedOrigin.lat, lon: resolvedOrigin.lon },
          destination: {
            lat: resolvedDestination.lat,
            lon: resolvedDestination.lon,
          },
          vehicle: {
            maxWeightKg: selectedTruck.max_weight_kg,
            maxHeightM: selectedTruck.max_height_m,
            maxWidthM: selectedTruck.max_width_m,
            maxLengthM: selectedTruck.max_length_m,
          },
          routingOptions: { ...ROUTING_OPTIONS },
        });

        if (!response.found) {
          setError(response.routeSummary || "No se encontró una ruta compatible.");
          return null;
        }
        onRouteCalculated(response);
        return {
          route: response,
          originLabel:      resolvedOrigin.label,
          destinationLabel: resolvedDestination.label,
          originLat:        resolvedOrigin.lat,
          originLon:        resolvedOrigin.lon,
          destinationLat:   resolvedDestination.lat,
          destinationLon:   resolvedDestination.lon,
        };
      } catch (err) {
        if (err instanceof SubscriptionRequiredError) {
          setSubscriptionRequired(true);
        } else {
          setError(err instanceof Error ? err.message : "Error al calcular la ruta.");
        }
        return null;
      }
    },
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <AutocompleteField
        label="Origen"
        placeholder="Dirección de salida"
        field={origin}
        setField={setOrigin}
        timerRef={originTimerRef}
        onPinned={onOriginPinned}
      />

      <AutocompleteField
        label="Destino"
        placeholder="Dirección de llegada"
        field={destination}
        setField={setDestination}
        timerRef={destTimerRef}
        onPinned={onDestinationPinned}
      />

      {subscriptionRequired && (
        <SubscriptionBanner onGoToPlans={onSubscriptionRequired} />
      )}
      {error && <ErrorMessage message={error} />}
    </div>
  );
});

export default RouteCalculator;

// ── Helpers ──────────────────────────────────────────────────────────────

async function resolveField(
  field: Field,
  setter: React.Dispatch<React.SetStateAction<Field>>,
): Promise<GeoSuggestion> {
  if (field.selected) return field.selected;
  const trimmed = field.value.trim();
  if (!trimmed) {
    throw new Error("Completá el origen y el destino.");
  }
  const resolved = await geocodeLocation(trimmed);
  setter({
    value: resolved.label,
    selected: resolved,
    suggestions: [],
    open: false,
  });
  return resolved;
}

// ── Subcomponentes ───────────────────────────────────────────────────────

interface AutocompleteFieldProps {
  label: string;
  placeholder: string;
  field: Field;
  setField: React.Dispatch<React.SetStateAction<Field>>;
  timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  onPinned?: (pin: PinPreview | null) => void;
}

function AutocompleteField({
  label,
  placeholder,
  field,
  setField,
  timerRef,
  onPinned,
}: AutocompleteFieldProps) {
  return (
    <div style={{ position: "relative" }}>
      <label className="st-label">{label}</label>
      <input
        className="st-input"
        placeholder={placeholder}
        value={field.value}
        onChange={(e) => {
          handleInput(setField, timerRef, e.target.value);
          if (!e.target.value.trim()) onPinned?.(null);
        }}
        onKeyDown={(e) => {
          // Si el desplegable de sugerencias está abierto, Escape solo lo cierra
          // a él (frenamos la propagación). Si no, dejamos que Escape siga de
          // largo: el modal tiene su propio listener global que lo cierra —
          // sin este freno, cerrar el desplegable cerraba también el modal
          // entero y se perdía la ruta ya cargada.
          if (e.key === "Escape" && field.open) {
            e.stopPropagation();
            setField((f) => ({ ...f, open: false }));
          }
        }}
        onBlur={() => handleBlur(setField)}
        autoComplete="off"
        required
      />
      {field.open && field.suggestions.length > 0 && (
        <ul style={dropdownStyle}>
          {field.suggestions.slice(0, MAX_SUGGESTIONS).map((s, i) => (
            <li
              key={`${s.label}-${i}`}
              style={dropdownItemStyle}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "#fafafa")
              }
              onMouseLeave={(e) => (e.currentTarget.style.background = "")}
              onMouseDown={(ev) => {
                ev.preventDefault();
                handleSelect(setField, s);
                onPinned?.({ lat: s.lat, lon: s.lon, label: s.label });
              }}
            >
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function handleInput(
  setter: React.Dispatch<React.SetStateAction<Field>>,
  timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  value: string,
) {
  setter((f) => ({ ...f, value, selected: null, open: false }));
  if (timerRef.current) clearTimeout(timerRef.current);
  if (value.trim().length < MIN_QUERY_LENGTH) {
    setter((f) => ({ ...f, suggestions: [], open: false }));
    return;
  }
  timerRef.current = setTimeout(async () => {
    const suggestions = await searchLocations(value.trim()).catch(() => []);
    setter((f) => ({
      ...f,
      suggestions,
      open: suggestions.length > 0,
    }));
  }, SEARCH_DEBOUNCE_MS);
}

function handleSelect(
  setter: React.Dispatch<React.SetStateAction<Field>>,
  s: GeoSuggestion,
) {
  setter({ value: s.label, selected: s, suggestions: [], open: false });
}

function handleBlur(setter: React.Dispatch<React.SetStateAction<Field>>) {
  // Pequeño delay para que el onMouseDown del item alcance a registrarse.
  setTimeout(
    () => setter((f) => ({ ...f, open: false })),
    BLUR_CLOSE_DELAY_MS,
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div
      style={{
        background: "rgba(229,57,53,0.06)",
        border: "1px solid rgba(229,57,53,0.2)",
        borderRadius: 10,
        padding: 12,
      }}
    >
      <p
        style={{
          color: "#c62828",
          fontWeight: 700,
          fontSize: "0.85rem",
          margin: 0,
        }}
      >
        {message}
      </p>
    </div>
  );
}

function SubscriptionBanner({ onGoToPlans }: { onGoToPlans?: () => void }) {
  return (
    <div
      style={{
        background: "rgba(229,57,53,0.06)",
        border: "1px solid rgba(229,57,53,0.2)",
        borderRadius: 10,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div>
        <p style={{ color: "#c62828", fontWeight: 700, fontSize: "0.88rem", margin: "0 0 4px" }}>
          Necesitás una suscripción activa
        </p>
        <p style={{ color: "#6b7280", fontSize: "0.82rem", margin: 0, lineHeight: 1.45 }}>
          Para calcular rutas debés tener un plan activo. Activá tu suscripción y empezá a operar.
        </p>
      </div>
      {onGoToPlans && (
        <button
          type="button"
          onClick={onGoToPlans}
          style={{
            alignSelf: "flex-start",
            background: "#e53935",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "8px 16px",
            fontSize: "0.82rem",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Ver planes y precios
        </button>
      )}
    </div>
  );
}

const dropdownStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  right: 0,
  background: "#fff",
  border: "1px solid #e0e0e0",
  borderRadius: 8,
  boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
  zIndex: 600,
  margin: 0,
  padding: "4px 0",
  listStyle: "none",
  maxHeight: 200,
  overflowY: "auto",
};

const dropdownItemStyle: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: "0.88rem",
  color: "#0d0d0d",
  cursor: "pointer",
};

