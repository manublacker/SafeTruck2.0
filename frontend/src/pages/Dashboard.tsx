import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { confirmCheckout } from "@/services/api";
import AdminSidebar, { type AdminPage } from "@/components/dashboard/AdminSidebar";
import AdminTopBar from "@/components/dashboard/AdminTopBar";
import AdminBottomNav from "@/components/dashboard/AdminBottomNav";
import LiveMapContainer from "@/components/dashboard/LiveMapContainer";
import FleetView from "@/components/dashboard/FleetView";
import TripHistoryView from "@/components/dashboard/TripHistoryView";
import AccountView from "@/components/dashboard/AccountView";
import PlansView from "@/components/dashboard/PlansView";

import "@/styles/admin.css";

const VALID_PAGES: AdminPage[] = ["map", "fleet", "active-trips", "trips", "account"];

const TITLE: Record<AdminPage, string> = {
  map:            "Live Map",
  fleet:          "Flota",
  "fleet-trucks": "Flota",
  "fleet-drivers":"Flota",
  "active-trips": "Viajes pendientes y en curso",
  trips:          "Historial de viajes",
  account:        "Mi cuenta",
  plans:          "Planes y suscripción",
};

function getInitialPage(): AdminPage {
  const hash = window.location.hash.slice(1) as AdminPage;
  return VALID_PAGES.includes(hash) ? hash : "map";
}

function formatDateEsAR(): string {
  try {
    return new Intl.DateTimeFormat("es-AR", {
      weekday: "long", day: "numeric", month: "long",
    }).format(new Date());
  } catch {
    return "";
  }
}

export default function Dashboard() {
  const [page, setPage]           = useState<AdminPage>(getInitialPage);
  const [collapsed, setCollapsed] = useState(false);
  const [today] = useState(() => formatDateEsAR());
  const [billingSuccess, setBillingSuccess] = useState(false);
  const { refreshPlan, refreshTrucks, refreshDrivers } = useAuth();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('billing') === 'success') {
      const plan = params.get('plan');
      setBillingSuccess(true);
      setPage('account');
      window.history.replaceState({}, '', window.location.pathname + window.location.hash);
      // Confirmamos el pago de forma síncrona (sin depender del webhook de MP)
      // y luego refrescamos plan + flota para que se vea actualizado al instante.
      confirmCheckout(plan)
        .catch((err) => console.error('Error al confirmar el pago:', err))
        .finally(() => {
          refreshPlan();
          refreshTrucks();
          refreshDrivers();
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSetPage(newPage: AdminPage) {
    window.location.hash = newPage;
    setPage(newPage);
  }

  return (
    <div className="admin-shell">
      <AdminSidebar page={page} setPage={handleSetPage} collapsed={collapsed} />
      <main className="admin-main">
        <AdminTopBar
          title={TITLE[page]}
          onToggleSidebar={() => setCollapsed((c) => !c)}
          onAccount={() => handleSetPage("account")}
        />
        <div className="admin-content">
          {/* Encabezado de página: título grande + fecha. SÓLO mobile
              (en desktop el título vive en el topbar; admin.css lo oculta). */}
          <div className="st-page-head">
            <h1 className="st-page-head-title">{TITLE[page]}</h1>
            {today && <div className="st-page-head-date">{today}</div>}
          </div>
          {page === "map"            && <LiveMapContainer onNavigate={handleSetPage} />}
          {page === "fleet"          && <FleetView onNavigate={handleSetPage} />}
          {page === "fleet-trucks"   && <FleetView onNavigate={handleSetPage} initialTab="trucks" />}
          {page === "fleet-drivers"  && <FleetView onNavigate={handleSetPage} initialTab="drivers" />}
          {page === "active-trips" && (
            <TripHistoryView
              statuses={["pending", "accepted", "in_progress"]}
              emptyTitle="No hay viajes pendientes ni en curso"
              emptySubtitle="Los viajes que asignes o que estén en camino van a aparecer acá."
            />
          )}
          {page === "trips" && (
            <TripHistoryView
              statuses={["completed", "cancelled"]}
              emptyTitle="Todavía no hay viajes finalizados"
              emptySubtitle="Acá vas a ver los viajes completados y cancelados, con su duración."
            />
          )}
          {page === "account" && <AccountView onNavigate={setPage} billingSuccess={billingSuccess} />}
          {page === "plans"   && <PlansView />}
        </div>
        {/* Barra inferior: sólo visible en mobile (la oculta admin.css en desktop). */}
        <AdminBottomNav page={page} setPage={handleSetPage} />
      </main>
    </div>
  );
}
