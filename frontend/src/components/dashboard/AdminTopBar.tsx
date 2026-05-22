import { Icons } from "./DashboardIcons";

interface Props {
  title: string;
  onToggleSidebar: () => void;
}

export default function AdminTopBar({ title, onToggleSidebar }: Props) {
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
        <h1 className="st-topbar-title">{title}</h1>
      </div>
    </header>
  );
}
