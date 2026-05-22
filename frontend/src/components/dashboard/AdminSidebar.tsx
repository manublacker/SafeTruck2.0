import { Icons } from "./DashboardIcons";
import { useAuth } from "@/contexts/AuthContext";
import safeTruckLogo from "@/assets/logo_safetruck.png";

export type AdminPage = "map" | "fleet" | "trips";

interface Props {
  page: AdminPage;
  setPage: (p: AdminPage) => void;
  collapsed: boolean;
}

const NAV_ITEMS: { key: AdminPage; label: string; icon: React.ReactNode }[] = [
  { key: "map",   label: "Live Map",  icon: <Icons.Map /> },
  { key: "fleet", label: "Flota",     icon: <Icons.Truck /> },
  { key: "trips", label: "Historial", icon: <Icons.Clock /> },
];

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export default function AdminSidebar({ page, setPage, collapsed }: Props) {
  const { user, logout } = useAuth();
  const width = collapsed ? 60 : 220;

  return (
    <aside
      className={`st-sidebar${collapsed ? " collapsed" : ""}`}
      style={{ width }}
    >
      {/* Logo */}
      <div
        style={{
          padding: collapsed ? "24px 8px 28px" : "24px 20px 28px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          justifyContent: collapsed ? "center" : "flex-start",
        }}
      >
        <div className="st-sidebar-logo-icon">
          <img
            src={safeTruckLogo}
            alt="SafeTruck"
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        </div>
        {!collapsed && (
          <div className="label-fade" style={{ lineHeight: 1.2 }}>
            <div className="st-sidebar-brand-sub">Logística AMBA</div>
            <div className="st-sidebar-brand-name">SafeTruck</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          flex: 1,
          padding: collapsed ? "0 8px" : "0 12px",
        }}
      >
        {NAV_ITEMS.map((it) => (
          <div
            key={it.key}
            title={collapsed ? it.label : undefined}
            className={`st-nav-item${page === it.key ? " active" : ""}`}
            style={{
              padding: collapsed ? "12px 0" : "12px 16px",
              justifyContent: collapsed ? "center" : "flex-start",
            }}
            onClick={() => setPage(it.key)}
          >
            <span style={{ width: 18, height: 18, display: "inline-flex", flexShrink: 0 }}>
              {it.icon}
            </span>
            {!collapsed && <span style={{ whiteSpace: "nowrap" }}>{it.label}</span>}
          </div>
        ))}
      </nav>

      {/* Footer: user */}
      <div
        className="st-sidebar-footer"
        style={{ padding: collapsed ? "20px 8px" : "20px" }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            justifyContent: collapsed ? "center" : "flex-start",
          }}
        >
          <div className="st-sidebar-user-avatar">
            {user ? initials(user.full_name) : "?"}
          </div>
          {!collapsed && user && (
            <div style={{ lineHeight: 1.3, flex: 1 }}>
              <div className="st-sidebar-user-name">{user.full_name}</div>
              <div className="st-sidebar-user-role">Admin</div>
            </div>
          )}
        </div>
        {!collapsed && (
          <button className="st-sidebar-logout" onClick={logout}>
            Cerrar sesión
          </button>
        )}
      </div>
    </aside>
  );
}
