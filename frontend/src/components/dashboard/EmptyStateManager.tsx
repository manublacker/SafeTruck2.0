import type { AdminPage } from "./AdminSidebar";

const INK = "#0d0d0d";
const MUTED = "#6b7280";
const LINE = "#f0f0f0";
const BRAND = "#e53935";

interface Props {
  hasTrucks: boolean;
  hasAvailableDrivers: boolean;
  hasAvailableTrucks: boolean;
  onNavigate: (page: AdminPage) => void;
}

/**
 * Decide qué bloque mostrar según la disponibilidad. Devuelve null cuando
 * todo está disponible — el padre se encarga de renderizar el flujo normal.
 *
 * Estados (de mayor a menor severidad):
 *   1. Sin camiones ni conductores activos → onboarding completo.
 *   2. Sin camiones (bloqueante)            → CTA a agregar camión.
 *   3. Sin conductores activos              → aviso, permite calcular ruta.
 *   4. Sin camiones disponibles             → aviso "todos en ruta".
 *   5. Todo disponible                      → null.
 */
export default function EmptyStateManager({
  hasTrucks,
  hasAvailableDrivers,
  hasAvailableTrucks,
  onNavigate,
}: Props) {
  if (!hasTrucks && !hasAvailableDrivers) {
    return (
      <FullOnboardingState
        onAddTrucks={() => onNavigate("fleet")}
        onAddDrivers={() => onNavigate("fleet")}
      />
    );
  }

  if (!hasTrucks) {
    return <NoTrucksBlockingState onAddTrucks={() => onNavigate("fleet")} />;
  }

  if (!hasAvailableDrivers) {
    return (
      <NoAvailableDriversNotice onAddDrivers={() => onNavigate("fleet")} />
    );
  }

  if (!hasAvailableTrucks) {
    return <AllTrucksOnRouteNotice />;
  }

  return null;
}

function FullOnboardingState({
  onAddTrucks,
  onAddDrivers,
}: {
  onAddTrucks: () => void;
  onAddDrivers: () => void;
}) {
  return (
    <Card>
      <Eyebrow>Primeros pasos</Eyebrow>
      <Title>Configurá tu flota</Title>
      <Body>
        Para empezar a planificar viajes necesitás registrar al menos un
        camión y un conductor activo.
      </Body>
      <ButtonRow>
        <button className="st-btn-primary" onClick={onAddTrucks}>
          Agregar camión
        </button>
        <button className="st-btn-secondary" onClick={onAddDrivers}>
          Agregar conductor
        </button>
      </ButtonRow>
    </Card>
  );
}

function NoTrucksBlockingState({ onAddTrucks }: { onAddTrucks: () => void }) {
  return (
    <Card>
      <Eyebrow>Falta tu flota</Eyebrow>
      <Title>Agregá un camión para continuar</Title>
      <Body>
        No podemos calcular rutas sin un camión registrado. Una vez que cargues
        sus dimensiones vas a poder planificar viajes seguros.
      </Body>
      <ButtonRow>
        <button className="st-btn-primary" onClick={onAddTrucks}>
          Agregar camión
        </button>
      </ButtonRow>
    </Card>
  );
}

function NoAvailableDriversNotice({
  onAddDrivers,
}: {
  onAddDrivers: () => void;
}) {
  return (
    <Card tone="warning">
      <Eyebrow>Sin conductores activos</Eyebrow>
      <Title>Podés calcular rutas, pero no asignar viajes</Title>
      <Body>
        Activá un conductor o agregá uno nuevo para crear viajes desde el
        cálculo de ruta.
      </Body>
      <ButtonRow>
        <button className="st-btn-secondary" onClick={onAddDrivers}>
          Gestionar conductores
        </button>
      </ButtonRow>
    </Card>
  );
}

function AllTrucksOnRouteNotice() {
  return (
    <Card tone="warning">
      <Eyebrow>Flota ocupada</Eyebrow>
      <Title>Todos los camiones están en ruta</Title>
      <Body>
        Cuando alguno finalice su viaje volverá a estar disponible para
        planificar uno nuevo.
      </Body>
    </Card>
  );
}

// ── Subcomponentes presentacionales ──────────────────────────────────────

function Card({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warning";
}) {
  const background = tone === "warning" ? "rgba(229,57,53,0.04)" : "#fafafa";
  const borderColor = tone === "warning" ? "rgba(229,57,53,0.2)" : LINE;
  return (
    <div
      style={{
        background,
        border: `1px solid ${borderColor}`,
        borderRadius: 14,
        padding: 24,
        maxWidth: 520,
        margin: "32px auto",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="st-section-eyebrow">{children}</div>;
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        fontSize: "1.15rem",
        fontWeight: 800,
        color: INK,
        margin: 0,
      }}
    >
      {children}
    </h3>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: "0.9rem",
        color: MUTED,
        lineHeight: 1.5,
      }}
    >
      {children}
    </p>
  );
}

function ButtonRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
      {children}
    </div>
  );
}

// Re-export para consumers que quieran mantener alineado el color brand.
export const EMPTY_STATE_BRAND_COLOR = BRAND;
