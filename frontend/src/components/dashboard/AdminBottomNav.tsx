import { Icons } from "./DashboardIcons";
import type { AdminPage } from "./AdminSidebar";

/**
 * Barra de navegación inferior — SOLO se ve en mobile (la oculta admin.css en
 * desktop, donde sigue el sidebar). Replica las 4 pestañas del sidebar:
 * Live Map · Flota · Viajes · Historial.
 */
const TABS: { key: AdminPage; label: string; icon: React.ReactNode }[] = [
  { key: "map",          label: "Live Map",  icon: <Icons.Map /> },
  { key: "fleet",        label: "Flota",     icon: <Icons.Truck /> },
  { key: "active-trips", label: "Viajes",    icon: <Icons.Arrow /> },
  { key: "trips",        label: "Historial", icon: <Icons.Clock /> },
];

interface Props {
  page: AdminPage;
  setPage: (p: AdminPage) => void;
}

export default function AdminBottomNav({ page, setPage }: Props) {
  // Las variantes de flota (fleet-trucks/fleet-drivers) resaltan "Flota".
  const activeKey: AdminPage =
    page === "fleet-trucks" || page === "fleet-drivers" ? "fleet" : page;

  return (
    <nav className="st-bottomnav" aria-label="Navegación principal">
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          className={`st-bottomnav-item${activeKey === t.key ? " active" : ""}`}
          onClick={() => setPage(t.key)}
          aria-current={activeKey === t.key ? "page" : undefined}
        >
          <span className="st-bottomnav-icon">{t.icon}</span>
          <span className="st-bottomnav-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
