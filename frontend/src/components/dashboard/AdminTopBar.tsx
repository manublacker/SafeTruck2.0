import { useState } from "react";
import { Icons } from "./DashboardIcons";
import { useAuth } from "@/contexts/AuthContext";
import safeTruckLogo from "@/assets/logo_safetruck.png";

interface Props {
  title: string;
  onToggleSidebar: () => void;
  /** Navegar a "Mi cuenta" (lo usa el botón de cuenta que sólo se ve en mobile). */
  onAccount?: () => void;
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

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export default function AdminTopBar({ title, onToggleSidebar, onAccount }: Props) {
  const [today] = useState(() => formatDateEsAR());
  const { user } = useAuth();

  return (
    <header className="st-topbar">
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <button
          className="st-toggle-btn hide-on-mobile"
          onClick={onToggleSidebar}
          title="Colapsar/expandir panel"
          aria-label="Colapsar/expandir panel"
        >
          <Icons.PanelLeft size={20} />
        </button>

        {/* Marca: SÓLO en mobile (en desktop la marca está en el sidebar). */}
        <div className="st-topbar-brand-mobile">
          <span className="st-topbar-brand-logo">
            <img src={safeTruckLogo} alt="SafeTruck" />
          </span>
          <span className="st-topbar-brand-text">
            <span className="st-topbar-brand-sub">Logística AMBA</span>
            <span className="st-topbar-brand-name">SafeTruck</span>
          </span>
        </div>

        <h1 className="st-topbar-title hide-on-mobile">
          {title}
        </h1>
        {today && (
          <span
            className="hide-on-mobile"
            style={{
              fontSize: "0.82rem",
              color: "var(--c-ink-3)",
              fontWeight: 500,
              textTransform: "capitalize",
              marginLeft: 4,
            }}
          >
            {today}
          </span>
        )}
      </div>

      {/* Botón de cuenta: SÓLO en mobile (en desktop el acceso está en el sidebar). */}
      <button
        type="button"
        className="st-topbar-account-mobile"
        onClick={onAccount}
        aria-label="Mi cuenta"
        title="Mi cuenta"
      >
        {user ? initials(user.full_name) : "?"}
      </button>
    </header>
  );
}
