import { useState } from "react";
import { Icons } from "./DashboardIcons";

interface Props {
  title: string;
  onToggleSidebar: () => void;
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

export default function AdminTopBar({ title, onToggleSidebar }: Props) {
  const [today] = useState(() => formatDateEsAR());

  return (
    <header
      style={{
        background: "#fff",
        borderBottom: "1px solid #f0f0f0",
        height: 56,
        padding: "0 24px 0 12px",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          className="st-toggle-btn"
          onClick={onToggleSidebar}
          title="Colapsar/expandir panel"
          aria-label="Colapsar/expandir panel"
        >
          <Icons.PanelLeft size={20} />
        </button>
        <h1 style={{ fontSize: "1.1rem", fontWeight: 800, color: "#0d0d0d", margin: 0 }}>
          {title}
        </h1>
        {today && (
          <span
            className="hide-on-mobile"
            style={{
              fontSize: "0.82rem",
              color: "#9ca3af",
              fontWeight: 500,
              textTransform: "capitalize",
              marginLeft: 4,
            }}
          >
            {today}
          </span>
        )}
      </div>
    </header>
  );
}
