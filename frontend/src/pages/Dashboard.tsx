import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { confirmCheckout } from "@/services/api";
import AdminSidebar, { type AdminPage } from "@/components/dashboard/AdminSidebar";
import AdminTopBar from "@/components/dashboard/AdminTopBar";
import AdminBottomNav from "@/components/dashboard/AdminBottomNav";
import LiveMapContainer from "@/components/dashboard/LiveMapContainer";
import FleetView from "@/components/dashboard/FleetView";
import MaintenanceView, { prefetchMaintenance } from "@/components/dashboard/MaintenanceView";
import TripHistoryView, { prefetchTrips } from "@/components/dashboard/TripHistoryView";
import AccountView from "@/components/dashboard/AccountView";
import PlansView from "@/components/dashboard/PlansView";
import type { AssignedTrip } from "@/services/api";

import "@/styles/admin.css";

const VALID_PAGES: AdminPage[] = ["map", "fleet", "maintenance", "active-trips", "account"];

const TITLE: Record<AdminPage, string> = {
  map:            "Live Map",
  fleet:          "Flota",
  "fleet-trucks": "Flota",
  "fleet-drivers":"Flota",
  maintenance:    "Mantenimiento",
  "active-trips": "Viajes",
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
  // Viaje que el usuario pidió "Ver viaje" desde el detalle: lo llevamos al mapa.
  const [tripToShow, setTripToShow] = useState<AssignedTrip | null>(null);
  const { refreshPlan, refreshTrucks, refreshDrivers } = useAuth();

  // Prefetch de las vistas del panel apenas se monta el Dashboard: los datos de
  // viajes y mantenimiento quedan cacheados en memoria, así al navegar a esas
  // pantallas ya están listos (sin el "Cargando…" de la primera vez). Deduplicado:
  // si el usuario entra a la vista mientras el pedido está en vuelo, lo reusa.
  useEffect(() => {
    void prefetchTrips().catch(() => {});
    void prefetchMaintenance().catch(() => {});
  }, []);

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

  function handleViewTrip(trip: AssignedTrip) {
    setTripToShow(trip);
    handleSetPage("map");
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
          {page === "map"            && <LiveMapContainer onNavigate={handleSetPage} tripToShow={tripToShow} onTripShown={() => setTripToShow(null)} />}
          {page === "fleet"          && <FleetView onNavigate={handleSetPage} />}
          {page === "fleet-trucks"   && <FleetView onNavigate={handleSetPage} initialTab="trucks" />}
          {page === "fleet-drivers"  && <FleetView onNavigate={handleSetPage} initialTab="drivers" />}
          {page === "maintenance"    && <MaintenanceView onNavigate={handleSetPage} />}
          {page === "active-trips" && (
            <TripHistoryView
              statuses={["pending", "accepted", "in_progress", "completed", "cancelled"]}
              emptyTitle="Todavía no hay viajes"
              emptySubtitle="Los viajes que asignes o que hagan tus conductores van a aparecer acá, incluido el historial de finalizados."
              onViewTrip={handleViewTrip}
              allowDelete
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
