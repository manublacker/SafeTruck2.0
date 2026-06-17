import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { confirmCheckout } from "@/services/api";
import AdminSidebar, { type AdminPage } from "@/components/dashboard/AdminSidebar";
import AdminTopBar from "@/components/dashboard/AdminTopBar";
import LiveMapContainer from "@/components/dashboard/LiveMapContainer";
import FleetView from "@/components/dashboard/FleetView";
import TripHistoryView from "@/components/dashboard/TripHistoryView";
import AccountView from "@/components/dashboard/AccountView";
import PlansView from "@/components/dashboard/PlansView";

import "@/styles/admin.css";

const VALID_PAGES: AdminPage[] = ["map", "fleet", "trips", "account"];

const TITLE: Record<AdminPage, string> = {
  map:     "Live Map",
  fleet:   "Flota",
  trips:   "Historial de viajes",
  account: "Mi cuenta",
  plans:   "Planes y suscripción",
};

function getInitialPage(): AdminPage {
  const hash = window.location.hash.slice(1) as AdminPage;
  return VALID_PAGES.includes(hash) ? hash : "map";
}

export default function Dashboard() {
  const [page, setPage]           = useState<AdminPage>(getInitialPage);
  const [collapsed, setCollapsed] = useState(false);
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
        <AdminTopBar title={TITLE[page]} onToggleSidebar={() => setCollapsed((c) => !c)} />
        <div className="admin-content">
          {page === "map"     && <LiveMapContainer onNavigate={handleSetPage} />}
          {page === "fleet"   && <FleetView />}
          {page === "trips"   && <TripHistoryView />}
          {page === "account" && <AccountView onNavigate={setPage} billingSuccess={billingSuccess} />}
          {page === "plans"   && <PlansView />}
        </div>
      </main>
    </div>
  );
}
