import { useState, useEffect } from "react";
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('billing') === 'success') {
      setBillingSuccess(true);
      setPage('account');
      window.history.replaceState({}, '', window.location.pathname + window.location.hash);
    }
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
