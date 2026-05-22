import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export default function AuthCallback() {
  const { user, authReady } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.get("type") === "recovery") {
      navigate("/reset-password", { replace: true });
      return;
    }
    if (!authReady) return;
    if (user) navigate("/dashboard", { replace: true });
    else navigate("/login", { replace: true });
  }, [user, authReady, navigate]);

  return (
    <div className="tw-page font-sans min-h-screen bg-[#1C2B3A] flex items-center justify-center">
      <div className="text-white text-center">
        <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin mx-auto mb-4" />
        <p>Iniciando sesión…</p>
      </div>
    </div>
  );
}
