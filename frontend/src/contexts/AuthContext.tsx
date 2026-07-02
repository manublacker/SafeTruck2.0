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
import type { Session } from "@supabase/supabase-js";
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
  // true una vez que el perfil se cargó de verdad desde el backend (o por login
  // explícito). Sirve para distinguir "no tenés plan" (plan null real) de "no
  // pudimos leer el plan" (fallback de sesión por backend caído). El paywall
  // sólo debe bloquear en el primer caso.
  profileFetched: boolean;
  drivers: Driver[];
  refreshDrivers: () => Promise<void>;
  refreshTrucks: () => Promise<void>;
  refreshPlan: () => Promise<void>;
  login: (token: string, user: AuthUser) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]        = useState<AuthUser | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [drivers, setDrivers]  = useState<Driver[]>([]);
  const [authReady, setAuthReady] = useState(false);
  // Estado (no ref) para que ProtectedRoute reaccione: el perfil se cargó desde
  // el backend, así que el `plan` es confiable (null real = sin suscripción).
  const [profileFetched, setProfileFetched] = useState(false);
  // Holds the in-flight ensureProfile promise so concurrent callers (the
  // IIFE and onAuthStateChange's INITIAL_SESSION event) await the same fetch
  // instead of one returning early and letting setAuthReady(true) fire before
  // the user is set — which caused a redirect to /login on every refresh.
  const profileFetchPromise = useRef<Promise<void> | null>(null);
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

  // Builds a minimal AuthUser straight from the Supabase session. Used as a
  // fallback when the backend /profile call fails on reload — without it,
  // any transient backend error would leave `user = null` and ProtectedRoute
  // would kick the user back to /login despite having a valid session.
  const userFromSession = (session: Session): AuthUser => {
    const meta = session.user.user_metadata ?? {};
    return {
      id:        session.user.id,
      email:     session.user.email ?? "",
      full_name: (meta.full_name as string) ?? "",
      company:   (meta.company as string) ?? null,
      plan:      null,
      role:      (meta.role as "admin" | "driver" | undefined) ?? "admin",
      trucks:    [],
      drivers:   [],
    };
  };

  const ensureProfile = useCallback((session: Session): Promise<void> => {
    if (profileFetchPromise.current) return profileFetchPromise.current;

    profileFetchPromise.current = (async () => {
      const accessToken = session.access_token;
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
        setProfileFetched(true);
      } catch (err) {
        console.error("Error al obtener el perfil:", err);
        // Fallback: keep the user logged in with whatever the session gives us.
        // The backend may be momentarily unreachable, but a valid Supabase
        // session shouldn't be punished with a forced logout.
        setUser((current) => current ?? userFromSession(session));
      } finally {
        profileFetchPromise.current = null;
      }
    })();

    return profileFetchPromise.current;
  }, []);

  useEffect(() => {
    (async () => {
      let { data: { session } } = await supabase.auth.getSession();

      // If the cached access_token is expired (or about to expire), refresh
      // it before fetching the profile. Without this, returning from MercadoPago
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
        await ensureProfile(session);
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
          ensureProfile(session);
        }
      } else {
        removeToken();
        setTokenState(null);
        setUser(null);
        setDrivers([]);
        profileLoaded.current = false; // Reset so next login loads the profile
        setProfileFetched(false);
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshPlan = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const res = await fetchUserProfile(session.access_token, {})
      setUser(u => u ? { ...u, plan: res.user.plan } : u)
    } catch {}
  }, [])

  const login = useCallback((newToken: string, newUser: AuthUser) => {
    setToken(newToken);
    setTokenState(newToken);
    setUser(newUser);
    setDrivers(newUser.drivers ?? []);
    // El login explícito trae el perfil autoritativo (incluido el plan) desde
    // /api/auth/profile, así que el gate ya puede confiar en newUser.plan.
    profileLoaded.current = true;
    setProfileFetched(true);
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    removeToken();
    setTokenState(null);
    setUser(null);
    setDrivers([]);
    profileLoaded.current = false;
    setProfileFetched(false);
  }, []);

  useEffect(() => {
    registerUnauthorizedHandler(logout);
  }, [logout]);

  return (
    <AuthContext.Provider
      value={{ user, token, authReady, profileFetched, drivers, refreshDrivers, refreshTrucks, refreshPlan, login, logout }}
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
