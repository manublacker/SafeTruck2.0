import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useAuth } from "@/contexts/AuthContext";
import { searchLocations, geocodeLocation, type GeoSuggestion } from "@/services/geocoding";

const BASE_URL = import.meta.env.VITE_API_URL ?? "";

const DEFAULT_CENTER: L.LatLngTuple = [-34.6037, -58.3816];
const DEFAULT_ZOOM = 11;

const SEG_COLORS = { ok: "#34C759", unauthorized: "#FF3B30", unknown: "#FF9500" };

interface AivenSegment {
  id: string;
  street_name: string;
  municipality: string;
  coordinates: { lat: number; lng: number }[];
  status: "ok" | "unauthorized" | "unknown";
}

interface AivenRoute {
  segments: AivenSegment[];
  total_distance_km: number;
  total_duration_min: number;
  has_unauthorized: boolean;
  has_unknown: boolean;
}

function createMarkerIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.25);"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function buildStreets(segments: AivenSegment[]): { calle: string; distM: number }[] {
  const out: { calle: string; distM: number }[] = [];
  let cur: string | null = null;
  let acc = 0;
  for (const seg of segments) {
    const calle = seg.street_name || "Calle sin nombre";
    let segDist = 0;
    for (let i = 0; i < seg.coordinates.length - 1; i++) {
      segDist += haversineM(seg.coordinates[i], seg.coordinates[i + 1]);
    }
    if (calle === cur) { acc += segDist; }
    else { if (cur) out.push({ calle: cur, distM: acc }); cur = calle; acc = segDist; }
  }
  if (cur) out.push({ calle: cur, distM: acc });
  return out.filter((s) => s.distM >= 10);
}

function fmtDist(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

interface Field {
  value: string;
  selected: GeoSuggestion | null;
  suggestions: GeoSuggestion[];
  open: boolean;
}

function emptyField(): Field {
  return { value: "", selected: null, suggestions: [], open: false };
}

export default function LiveMapView() {
  const { user } = useAuth();
  const trucks = user?.trucks ?? [];

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef          = useRef<L.Map | null>(null);
  const polylinesRef    = useRef<L.Polyline[]>([]);
  const markerRef       = useRef<L.Marker | null>(null);

  const [origin, setOrigin]           = useState<Field>(emptyField());
  const [destination, setDestination] = useState<Field>(emptyField());

  const [truckId, setTruckId] = useState<number | "custom">(trucks[0]?.id ?? "custom");
  const truck = trucks.find((t) => t.id === truckId);

  const [weight, setWeight] = useState(trucks[0]?.max_weight_kg ?? 12000);
  const [height, setHeight] = useState(trucks[0]?.max_height_m  ?? 4.0);
  const [width,  setWidth]  = useState(trucks[0]?.max_width_m   ?? 2.5);
  const [length, setLength] = useState(trucks[0]?.max_length_m  ?? 12);

  const [date, setDate] = useState("");
  const [time, setTime] = useState("");

  const [loading,    setLoading]    = useState(false);
  const [aivenRoute, setAivenRoute] = useState<AivenRoute | null>(null);
  const [error,      setError]      = useState("");

  const originTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inicializar mapa
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = L.map(mapContainerRef.current, { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors", maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    const onResize = () => map.invalidateSize();
    window.addEventListener("resize", onResize);
    setTimeout(() => map.invalidateSize(), 100);
    return () => { window.removeEventListener("resize", onResize); map.remove(); mapRef.current = null; };
  }, []);

  // Dibujar ruta con colores por segmento
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    polylinesRef.current.forEach((p) => p.remove());
    polylinesRef.current = [];
    markerRef.current?.remove();
    markerRef.current = null;

    if (!aivenRoute?.segments.length) return;

    const allLatLngs: L.LatLngTuple[] = [];

    for (const seg of aivenRoute.segments) {
      const latLngs: L.LatLngTuple[] = seg.coordinates.map((c) => [c.lat, c.lng]);
      if (latLngs.length < 2) continue;
      allLatLngs.push(...latLngs);
      const poly = L.polyline(latLngs, {
        color: SEG_COLORS[seg.status] ?? SEG_COLORS.unknown,
        weight: 5, opacity: 0.9, lineCap: "round", lineJoin: "round",
      }).addTo(map);
      polylinesRef.current.push(poly);
    }

    if (allLatLngs.length) {
      const dest = allLatLngs[allLatLngs.length - 1];
      markerRef.current = L.marker(dest, {
        icon: createMarkerIcon("#0d47a1"),
      }).addTo(map);
      map.fitBounds(L.latLngBounds(allLatLngs), { padding: [48, 48], maxZoom: 15 });
    }
  }, [aivenRoute]);

  // Autocomplete
  function handleInput(
    setter: React.Dispatch<React.SetStateAction<Field>>,
    timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
    value: string
  ) {
    setter((f) => ({ ...f, value, selected: null, open: false }));
    if (timerRef.current) clearTimeout(timerRef.current);
    if (value.trim().length < 3) { setter((f) => ({ ...f, suggestions: [], open: false })); return; }
    timerRef.current = setTimeout(async () => {
      const suggestions = await searchLocations(value.trim()).catch(() => []);
      setter((f) => ({ ...f, suggestions, open: suggestions.length > 0 }));
    }, 350);
  }

  function handleSelect(setter: React.Dispatch<React.SetStateAction<Field>>, s: GeoSuggestion) {
    setter({ value: s.label, selected: s, suggestions: [], open: false });
  }

  function handleBlur(setter: React.Dispatch<React.SetStateAction<Field>>) {
    setTimeout(() => setter((f) => ({ ...f, open: false })), 150);
  }

  async function resolveField(field: Field, setter: React.Dispatch<React.SetStateAction<Field>>): Promise<GeoSuggestion> {
    if (field.selected) return field.selected;
    const resolved = await geocodeLocation(field.value.trim());
    setter({ value: resolved.label, selected: resolved, suggestions: [], open: false });
    return resolved;
  }

  function selectTruck(id: number | "custom") {
    setTruckId(id);
    if (id === "custom") return;
    const t = trucks.find((x) => x.id === id);
    if (!t) return;
    setWeight(t.max_weight_kg); setHeight(t.max_height_m);
    setWidth(t.max_width_m);   setLength(t.max_length_m);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setAivenRoute(null);
    setLoading(true);
    try {
      const [o, d] = await Promise.all([
        resolveField(origin, setOrigin),
        resolveField(destination, setDestination),
      ]);
      const res = await fetch(`${BASE_URL}/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin:      { lat: o.lat, lng: o.lon },
          destination: { lat: d.lat, lng: d.lon },
          vehicle: {
            weight_kg: truck?.max_weight_kg ?? weight,
            height_m:  truck?.max_height_m  ?? height,
            width_m:   truck?.max_width_m   ?? width,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error ?? "No se encontró una ruta compatible.");
      setAivenRoute(data.route);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al calcular la ruta.");
    } finally {
      setLoading(false);
    }
  }

  const streets = aivenRoute ? buildStreets(aivenRoute.segments) : [];
  const warnings: string[] = aivenRoute
    ? [
        ...(aivenRoute.has_unauthorized ? ["La ruta incluye tramos no habilitados para vehículos pesados."] : []),
        ...(aivenRoute.has_unknown      ? ["Algunos tramos no tienen datos de habilitación."] : []),
      ]
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

      {/* Mapa */}
      <div style={{ flex: "0 0 52%", padding: 20, background: "#fff" }}>
        <div ref={mapContainerRef} style={{
          width: "100%", height: "100%", borderRadius: 16,
          border: "1px solid #f0f0f0", boxShadow: "0 2px 12px rgba(0,0,0,0.08)", overflow: "hidden",
        }} />
      </div>

      {/* Panel inferior: formulario + resultado */}
      <div style={{
        flex: "1 1 48%", background: "#fff", borderTop: "1px solid #f0f0f0",
        display: "flex", minHeight: 0, overflow: "hidden",
      }}>

        {/* Formulario */}
        <div style={{ flex: "0 0 55%", padding: "20px 20px 20px 24px", overflowY: "auto", borderRight: "1px solid #f0f0f0" }}>
          <h2 style={{ fontSize: "0.95rem", fontWeight: 800, color: "#0d0d0d", margin: "0 0 16px" }}>Planificá tu ruta</h2>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Origen */}
            <div style={{ position: "relative" }}>
              <label className="st-label">Origen</label>
              <input className="st-input" placeholder="Dirección de salida" value={origin.value}
                onChange={(e) => handleInput(setOrigin, originTimerRef, e.target.value)}
                onBlur={() => handleBlur(setOrigin)} autoComplete="off" required />
              {origin.open && origin.suggestions.length > 0 && (
                <ul style={dropdownStyle}>
                  {origin.suggestions.slice(0, 6).map((s, i) => (
                    <li key={i} style={dropdownItemStyle}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#fafafa")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                      onMouseDown={(ev) => { ev.preventDefault(); handleSelect(setOrigin, s); }}>
                      {s.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Destino */}
            <div style={{ position: "relative" }}>
              <label className="st-label">Destino</label>
              <input className="st-input" placeholder="Dirección de llegada" value={destination.value}
                onChange={(e) => handleInput(setDestination, destTimerRef, e.target.value)}
                onBlur={() => handleBlur(setDestination)} autoComplete="off" required />
              {destination.open && destination.suggestions.length > 0 && (
                <ul style={dropdownStyle}>
                  {destination.suggestions.slice(0, 6).map((s, i) => (
                    <li key={i} style={dropdownItemStyle}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#fafafa")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                      onMouseDown={(ev) => { ev.preventDefault(); handleSelect(setDestination, s); }}>
                      {s.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Camión */}
            {trucks.length > 0 ? (
              <div>
                <label className="st-label">Camión</label>
                <select className={`st-select${truckId === "custom" ? " placeholder" : ""}`}
                  value={truckId === "custom" ? "custom" : String(truckId)}
                  onChange={(e) => selectTruck(e.target.value === "custom" ? "custom" : Number(e.target.value))}>
                  {trucks.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} · {t.max_weight_kg / 1000} t · {t.max_height_m} m alt</option>
                  ))}
                  <option value="custom">Ingresar manualmente</option>
                </select>
              </div>
            ) : null}

            {/* Dimensiones manuales */}
            {(truckId === "custom" || trucks.length === 0) && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><label className="st-label">Peso (kg)</label>
                  <input type="number" className="st-input" value={weight} min={1}
                    onChange={(e) => setWeight(Number(e.target.value))} required /></div>
                <div><label className="st-label">Altura (m)</label>
                  <input type="number" className="st-input" value={height} min={0.1} step={0.1}
                    onChange={(e) => setHeight(Number(e.target.value))} required /></div>
                <div><label className="st-label">Ancho (m)</label>
                  <input type="number" className="st-input" value={width} min={0.1} step={0.1}
                    onChange={(e) => setWidth(Number(e.target.value))} required /></div>
                <div><label className="st-label">Largo (m)</label>
                  <input type="number" className="st-input" value={length} min={0.1} step={0.1}
                    onChange={(e) => setLength(Number(e.target.value))} required /></div>
              </div>
            )}

            {/* Fecha / Hora (opcionales) */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><label className="st-label">Fecha (opcional)</label>
                <input type="date" className="st-input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <div><label className="st-label">Hora (opcional)</label>
                <input type="time" className="st-input" value={time} onChange={(e) => setTime(e.target.value)} /></div>
            </div>

            <button type="submit" className="st-btn-primary" style={{ width: "100%" }} disabled={loading}>
              {loading ? "Calculando…" : "Calcular ruta"}
            </button>
          </form>
        </div>

        {/* Resultado */}
        <div style={{ flex: 1, padding: "20px 24px 20px 20px", overflowY: "auto" }}>
          <h2 style={{ fontSize: "0.95rem", fontWeight: 800, color: "#0d0d0d", margin: "0 0 16px" }}>Resultado</h2>

          {!aivenRoute && !error && !loading && (
            <p style={{ color: "#9ca3af", fontSize: "0.88rem" }}>
              Completá origen y destino para ver la ruta.
            </p>
          )}

          {loading && (
            <p style={{ color: "#6b7280", fontSize: "0.88rem" }}>Calculando ruta…</p>
          )}

          {error && (
            <div style={{ background: "rgba(229,57,53,0.06)", border: "1px solid rgba(229,57,53,0.2)", borderRadius: 10, padding: 14 }}>
              <p style={{ color: "#c62828", fontWeight: 700, fontSize: "0.88rem", margin: 0 }}>{error}</p>
            </div>
          )}

          {aivenRoute && (
            <>
              <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                <div style={statBox}>
                  <span style={statLabel}>Distancia</span>
                  <span style={statValue}>{fmtDist(aivenRoute.total_distance_km * 1000)}</span>
                </div>
                <div style={statBox}>
                  <span style={statLabel}>Duración</span>
                  <span style={statValue}>{aivenRoute.total_duration_min} min</span>
                </div>
              </div>

              {/* Leyenda */}
              <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
                {(["ok", "unauthorized", "unknown"] as const).map((s) => (
                  <div key={s} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.75rem", color: "#6b7280" }}>
                    <div style={{ width: 12, height: 12, borderRadius: 2, background: SEG_COLORS[s], flexShrink: 0 }} />
                    {s === "ok" ? "Habilitada" : s === "unauthorized" ? "No habilitada" : "Sin datos"}
                  </div>
                ))}
              </div>

              {streets.length > 0 && (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  {streets.slice(0, 8).map((s, i) => (
                    <li key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "0.82rem", padding: "6px 0", borderBottom: "1px solid #f0f0f0" }}>
                      <span style={{ color: "#0d0d0d", fontWeight: 500 }}>{i + 1}. {s.calle}</span>
                      <span style={{ color: "#9ca3af", flexShrink: 0, marginLeft: 8 }}>{fmtDist(s.distM)}</span>
                    </li>
                  ))}
                  {streets.length > 8 && (
                    <li style={{ fontSize: "0.78rem", color: "#9ca3af", padding: "6px 0" }}>
                      +{streets.length - 8} calles más
                    </li>
                  )}
                </ul>
              )}

              {warnings.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  {warnings.map((w, i) => (
                    <p key={i} style={{ fontSize: "0.78rem", color: "#f97316", margin: "4px 0" }}>⚠ {w}</p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const dropdownStyle: React.CSSProperties = {
  position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
  background: "#fff", border: "1px solid #e0e0e0", borderRadius: 8,
  boxShadow: "0 4px 16px rgba(0,0,0,0.10)", zIndex: 600,
  margin: 0, padding: "4px 0", listStyle: "none", maxHeight: 200, overflowY: "auto",
};

const dropdownItemStyle: React.CSSProperties = {
  padding: "10px 14px", fontSize: "0.88rem", color: "#0d0d0d", cursor: "pointer",
};

const statBox: React.CSSProperties = {
  flex: 1, background: "#fafafa", border: "1px solid #f0f0f0",
  borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4,
};

const statLabel: React.CSSProperties = {
  fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.08em",
  color: "#9ca3af", textTransform: "uppercase",
};

const statValue: React.CSSProperties = {
  fontSize: "1.2rem", fontWeight: 800, color: "#0d0d0d",
};
