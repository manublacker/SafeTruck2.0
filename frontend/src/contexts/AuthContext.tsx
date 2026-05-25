import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import type { AuthUser, Driver } from "@/types/auth";
import { supabase } from "@/lib/supabase";
import {
  setToken,
  removeToken,
  registerUnauthorizedHandler,
  fetchDrivers,
  fetchTrucks,
} from "@/services/api";
import { fetchUserProfile } from "@/services/authApi";

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  authReady: boolean;
  drivers: Driver[];
  refreshDrivers: () => Promise<void>;
  refreshTrucks: () => Promise<void>;
  login: (token: string, user: AuthUser) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]        = useState<AuthUser | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [drivers, setDrivers]  = useState<Driver[]>([]);
  const [authReady, setAuthReady] = useState(false);
  const fetchingProfile = useRef(false);
  // Tracks whether the profile was successfully loaded at least once.
  // Fixes the stale-closure bug where `user` is always `null` inside the
  // onAuthStateChange callback (captured at mount), causing ensureProfile to
  // re-run on every TOKEN_REFRESHED event and risk a spurious 401 → logout.
  const profileLoaded = useRef(false);

  const refreshDrivers = useCallback(async () => {
    try {
      const list = await fetchDrivers();
      setDrivers(list);
    } catch (err) {
      console.error("Error al refrescar conductores:", err);
    }
  }, []);

  const refreshTrucks = useCallback(async () => {
    try {
      const list = await fetchTrucks();
      setUser((u) => (u ? { ...u, trucks: list } : u));
    } catch (err) {
      console.error("Error al refrescar camiones:", err);
    }
  }, []);

  const ensureProfile = useCallback(async (accessToken: string) => {
    if (fetchingProfile.current) return;
    fetchingProfile.current = true;
    try {
      const res = await fetchUserProfile(accessToken, {});
      // El backend devuelve trucks en /profile sin el campo `driver` y no
      // devuelve drivers — los traemos por separado vía /api/trucks y
      // /api/drivers para que el contexto exponga la relación completa.
      const [driversResult, trucksResult] = await Promise.allSettled([
        fetchDrivers(),
        fetchTrucks(),
      ]);
      const driversList =
        driversResult.status === "fulfilled" ? driversResult.value : [];
      if (driversResult.status === "rejected") {
        console.error("Error al obtener conductores:", driversResult.reason);
      }
      const trucksList =
        trucksResult.status === "fulfilled" ? trucksResult.value : res.user.trucks;
      if (trucksResult.status === "rejected") {
        console.error("Error al obtener camiones:", trucksResult.reason);
      }
      setUser({ ...res.user, trucks: trucksList, drivers: driversList });
      setDrivers(driversList);
      profileLoaded.current = true;
    } catch (err) {
      console.error("Error al obtener el perfil:", err);
    } finally {
      fetchingProfile.current = false;
    }
  }, []);

  useEffect(() => {
    (async () => {
      let { data: { session } } = await supabase.auth.getSession();

      // If the cached access_token is expired (or about to expire), refresh
      // it before fetching the profile. Without this, returning from Stripe
      // Checkout after >1h triggers a 401 on /profile, which fires the
      // unauthorized handler and logs the user out.
      if (session?.expires_at) {
        const expiresInSec = session.expires_at - Math.floor(Date.now() / 1000);
        if (expiresInSec < 60) {
          const { data: refreshed } = await supabase.auth.refreshSession();
          if (refreshed.session) session = refreshed.session;
        }
      }

      if (session) {
        setToken(session.access_token);
        setTokenState(session.access_token);
        await ensureProfile(session.access_token);
      }
      setAuthReady(true);
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setToken(session.access_token);
        setTokenState(session.access_token);
        // Use `profileLoaded` ref (not the stale `user` closure) to decide
        // whether to load the profile. This prevents re-running ensureProfile
        // on every TOKEN_REFRESHED event, which could trigger a spurious
        // 401 → logout cycle.
        if (!profileLoaded.current) {
          ensureProfile(session.access_token);
        }
      } else {
        removeToken();
        setTokenState(null);
        setUser(null);
        setDrivers([]);
        profileLoaded.current = false; // Reset so next login loads the profile
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback((newToken: string, newUser: AuthUser) => {
    setToken(newToken);
    setTokenState(newToken);
    setUser(newUser);
    setDrivers(newUser.drivers ?? []);
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    removeToken();
    setTokenState(null);
    setUser(null);
    setDrivers([]);
  }, []);

  useEffect(() => {
    registerUnauthorizedHandler(logout);
  }, [logout]);

  return (
    <AuthContext.Provider
      value={{ user, token, authReady, drivers, refreshDrivers, refreshTrucks, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}
