import { useState } from "react";
import AdminSidebar, { type AdminPage } from "@/components/dashboard/AdminSidebar";
import AdminTopBar from "@/components/dashboard/AdminTopBar";
import LiveMapContainer from "@/components/dashboard/LiveMapContainer";
import FleetView from "@/components/dashboard/FleetView";
import TripHistoryView from "@/components/dashboard/TripHistoryView";
import AccountView from "@/components/dashboard/AccountView";

import "@/styles/admin.css";

const VALID_PAGES: AdminPage[] = ["map", "fleet", "trips", "account"];

const TITLE: Record<AdminPage, string> = {
  map:     "Live Map",
  fleet:   "Flota",
  trips:   "Historial de viajes",
  account: "Mi cuenta",
};

function getInitialPage(): AdminPage {
  const hash = window.location.hash.slice(1) as AdminPage;
  return VALID_PAGES.includes(hash) ? hash : "map";
}

export default function Dashboard() {
  const [page, setPage]           = useState<AdminPage>(getInitialPage);
  const [collapsed, setCollapsed] = useState(false);

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
          {page === "account" && <AccountView />}
        </div>
      </main>
    </div>
  );
}
