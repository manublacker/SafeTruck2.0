import { useState } from "react";
import AdminSidebar, { type AdminPage } from "@/components/dashboard/AdminSidebar";
import AdminTopBar from "@/components/dashboard/AdminTopBar";
import LiveMapContainer from "@/components/dashboard/LiveMapContainer";
import FleetView from "@/components/dashboard/FleetView";
import TripHistoryView from "@/components/dashboard/TripHistoryView";

import "@/styles/admin.css";

const TITLE: Record<AdminPage, string> = {
  map:   "Live Map",
  fleet: "Flota",
  trips: "Historial de viajes",
};

export default function Dashboard() {
  const [page, setPage]           = useState<AdminPage>("map");
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="admin-shell">
      <AdminSidebar page={page} setPage={setPage} collapsed={collapsed} />
      <main className="admin-main">
        <AdminTopBar title={TITLE[page]} onToggleSidebar={() => setCollapsed((c) => !c)} />
        <div className="admin-content">
          {page === "map"   && <LiveMapContainer onNavigate={setPage} />}
          {page === "fleet" && <FleetView />}
          {page === "trips" && <TripHistoryView />}
        </div>
      </main>
    </div>
  );
}
