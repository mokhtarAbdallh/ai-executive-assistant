import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  apiJson,
  getAccessToken,
  IS_DEMO_MODE,
  onSessionExpired,
  refreshAccessToken,
  setAccessToken,
} from "../lib/http";
import { ensureDemoAuth } from "../api";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  /** Platform operator: may credit users' balances (re-checked by the API). */
  isPlatformAdmin?: boolean;
}

type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const DEMO_USER: SessionUser = { id: "usr-demo", email: "demo@dawwen.ai", name: "Dawwen Demo" };

interface AuthResponse {
  user: SessionUser;
  accessToken: string;
}

async function fetchMe(): Promise<SessionUser> {
  const { user } = await apiJson<{ user: SessionUser }>("/api/auth/me");
  return user;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);

  // Restore the session on load: stored access token, else the httpOnly refresh cookie.
  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      if (IS_DEMO_MODE) {
        await ensureDemoAuth();
        const me = await fetchMe().catch(() => DEMO_USER);
        if (!cancelled) {
          setUser(me);
          setStatus("authenticated");
        }
        return;
      }
      try {
        if (!getAccessToken() && !(await refreshAccessToken())) {
          throw new Error("no session");
        }
        const me = await fetchMe();
        if (!cancelled) {
          setUser(me);
          setStatus("authenticated");
        }
      } catch {
        if (!cancelled) {
          setAccessToken(null);
          setUser(null);
          setStatus("anonymous");
        }
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh failed mid-session (refresh token expired or revoked): back to login.
  useEffect(
    () =>
      onSessionExpired(() => {
        if (IS_DEMO_MODE) return;
        setUser(null);
        setStatus("anonymous");
      }),
    [],
  );

  const applyAuth = useCallback((data: AuthResponse) => {
    setAccessToken(data.accessToken);
    setUser(data.user);
    setStatus("authenticated");
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      applyAuth(
        await apiJson<AuthResponse>("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        }),
      );
    },
    [applyAuth],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      applyAuth(
        await apiJson<AuthResponse>("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ name, email, password }),
        }),
      );
    },
    [applyAuth],
  );

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } catch {
      // Even offline, the local session is cleared below.
    }
    setAccessToken(null);
    setUser(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo(
    () => ({ status, user, login, register, logout }),
    [status, user, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
