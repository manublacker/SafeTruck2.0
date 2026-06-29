import { useEffect, useRef, useState } from "react";
import { Icons } from "./DashboardIcons";
import { useAuth } from "@/contexts/AuthContext";
import safeTruckLogo from "@/assets/logo_safetruck.png";

export type AdminPage = "map" | "fleet" | "fleet-trucks" | "fleet-drivers" | "active-trips" | "trips" | "account" | "plans";

interface Props {
  page: AdminPage;
  setPage: (p: AdminPage) => void;
  collapsed: boolean;
}

const NAV_ITEMS: { key: AdminPage; label: string; icon: React.ReactNode }[] = [
  { key: "map",          label: "Live Map",  icon: <Icons.Map /> },
  { key: "fleet",        label: "Flota",     icon: <Icons.Truck /> },
  { key: "active-trips", label: "Viajes",    icon: <Icons.Arrow /> },
  { key: "trips",        label: "Historial", icon: <Icons.Clock /> },
];

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export default function AdminSidebar({ page, setPage, collapsed }: Props) {
  const { user, logout } = useAuth();
  const width = collapsed ? 60 : 220;
  const [popoverOpen, setPopoverOpen] = useState(false);
  const footerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popoverOpen) return;
    function handler(e: MouseEvent) {
      if (footerRef.current && !footerRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [popoverOpen]);

  function goAccount() { setPage("account"); setPopoverOpen(false); }
  function goPlans()   { setPage("plans");   setPopoverOpen(false); }
  function handleLogout() { setPopoverOpen(false); void logout(); }

  const plan = user?.plan ?? null;
  const isEnterprise = plan === "enterprise";

  return (
    <aside
      className={`st-sidebar${collapsed ? " collapsed" : ""}`}
      style={{ width, display: "flex", flexDirection: "column", flexShrink: 0, position: "relative" }}
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
          <img src={safeTruckLogo} alt="SafeTruck" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        </div>
        {!collapsed && (
          <div className="label-fade" style={{ lineHeight: 1.2 }}>
            <div className="st-sidebar-brand-sub">Logística AMBA</div>
            <div className="st-sidebar-brand-name">SafeTruck</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, padding: collapsed ? "0 8px" : "0 12px" }}>
        {NAV_ITEMS.map((it) => (
          <div
            key={it.key}
            title={collapsed ? it.label : undefined}
            className={`st-nav-item${page === it.key ? " active" : ""}`}
            style={{ padding: collapsed ? "12px 0" : "12px 16px", justifyContent: collapsed ? "center" : "flex-start" }}
            onClick={() => setPage(it.key)}
          >
            <span style={{ width: 18, height: 18, display: "inline-flex", flexShrink: 0 }}>{it.icon}</span>
            {!collapsed && <span style={{ whiteSpace: "nowrap" }}>{it.label}</span>}
          </div>
        ))}
      </nav>

      {/* Footer con popover */}
      <div
        ref={footerRef}
        className="st-sidebar-footer"
        style={{
          padding: collapsed ? "12px 8px" : "12px",
          position: "relative",
        }}
      >
        <button
          className="st-account-trigger"
          onClick={() => setPopoverOpen((o) => !o)}
          aria-expanded={popoverOpen}
          style={{ justifyContent: collapsed ? "center" : "flex-start" }}
        >
          <div className="st-sidebar-user-avatar" style={{ flexShrink: 0 }}>
            {user ? initials(user.full_name) : "?"}
          </div>
          {!collapsed && user && (
            <>
              <div style={{ lineHeight: 1.3, flex: 1, minWidth: 0 }}>
                <div
                  className="st-sidebar-user-name"
                  style={{ overflow: "hidden", textOverflow: "ellipsis" }}
                >
                  {user.full_name}
                </div>
                <div className="st-sidebar-user-role" style={{ textTransform: "capitalize" }}>
                  {plan ? `Plan ${plan}` : "Sin plan"}
                </div>
              </div>
              <span
                style={{
                  color: "rgba(255,255,255,0.55)",
                  display: "inline-flex",
                  transform: popoverOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease",
                  flexShrink: 0,
                }}
              >
                <Icons.ChevronUp size={14} />
              </span>
            </>
          )}
        </button>

        {popoverOpen && (
          <div
            className="st-account-popover"
            style={{ width: collapsed ? 200 : "calc(100% - 24px)" }}
          >
            <button className="st-popover-btn" onClick={goAccount}>
              <Icons.Settings size={16} />
              <span>Mi cuenta</span>
            </button>
            <button
              className="st-popover-btn"
              onClick={goPlans}
              disabled={isEnterprise}
              style={{ color: isEnterprise ? "rgba(255,255,255,0.55)" : "#fbbf24" }}
            >
              <Icons.Zap size={16} />
              <span>{isEnterprise ? "Plan Enterprise ✓" : "Mejorar plan"}</span>
            </button>
            <div className="st-popover-sep" />
            <button className="st-popover-btn logout" onClick={handleLogout}>
              <Icons.LogOut size={16} />
              <span>Cerrar sesión</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
