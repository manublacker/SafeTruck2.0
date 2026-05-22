import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

export default function UserButton() {
  const { user, logout }        = useAuth();
  const [dropOpen, setDropOpen] = useState(false);
  const dropRef                 = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setDropOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropOpen]);

  function initials(name: string) {
    return name
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("");
  }

  if (!user) return null;

  return (
    <div className="user-btn-wrapper" ref={dropRef}>
      <button
        className="user-btn user-btn--avatar"
        onClick={() => setDropOpen((v) => !v)}
        title={user.full_name}
        aria-expanded={dropOpen}
      >
        <span className="user-avatar">{initials(user.full_name)}</span>
        <span className="user-name-short">{user.full_name.split(" ")[0]}</span>
      </button>

      {dropOpen && (
        <div className="user-dropdown">
          {/* Profile header */}
          <div className="user-drop-header">
            <div className="user-drop-avatar">{initials(user.full_name)}</div>
            <div>
              <p className="user-drop-name">{user.full_name}</p>
              <p className="user-drop-email">{user.email}</p>
              {user.company && (
                <p className="user-drop-company">{user.company}</p>
              )}
            </div>
          </div>

          {/* Trucks */}
          {user.trucks.length > 0 && (
            <div className="user-drop-section">
              <p className="user-drop-section-title">Mis camiones</p>
              <ul className="user-truck-list">
                {user.trucks.map((t) => (
                  <li key={t.id} className="user-truck-item">
                    <span className="user-truck-name">{t.name}</span>
                    <span className="user-truck-specs">
                      {t.max_weight_kg / 1000} t · {t.max_height_m} m alt · {t.max_width_m} m ancho · {t.max_length_m} m largo
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {user.trucks.length === 0 && (
            <p className="user-drop-no-trucks">Sin camiones registrados.</p>
          )}

          {/* Logout */}
          <button
            className="user-drop-logout"
            onClick={() => {
              logout();
              setDropOpen(false);
            }}
          >
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}
