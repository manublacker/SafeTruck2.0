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
    <header className="st-topbar">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          className="st-toggle-btn"
          onClick={onToggleSidebar}
          title="Colapsar/expandir panel"
          aria-label="Colapsar/expandir panel"
        >
          <Icons.PanelLeft size={20} />
        </button>
        <h1 className="st-topbar-title">
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
    </header>
  );
}
