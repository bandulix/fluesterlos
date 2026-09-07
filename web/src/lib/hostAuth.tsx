import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { api } from "./api";

export type HostAuthStatus = {
  needsBootstrap: boolean;
  authenticated: boolean;
  email?: string;
  role?: string;
  id?: string;
};

type HostAuthContextValue = {
  auth: HostAuthStatus | null;
  refreshAuth: () => Promise<HostAuthStatus>;
  logout: () => Promise<void>;
};

const HostAuthContext = createContext<HostAuthContextValue | null>(null);

export function HostAuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<HostAuthStatus | null>(null);

  const refreshAuth = useCallback(async () => {
    const status = await api<HostAuthStatus>("/api/host/auth/status");
    setAuth(status);
    return status;
  }, []);

  const logout = useCallback(async () => {
    await api("/api/host/auth/logout", { method: "POST" });
    setAuth(await api<HostAuthStatus>("/api/host/auth/status"));
  }, []);

  useEffect(() => {
    localStorage.removeItem("fl_host_token");
    refreshAuth().catch(() => setAuth({ needsBootstrap: false, authenticated: false }));
  }, [refreshAuth]);

  return (
    <HostAuthContext.Provider value={{ auth, refreshAuth, logout }}>
      {children}
    </HostAuthContext.Provider>
  );
}

export function useHostAuth() {
  const ctx = useContext(HostAuthContext);
  if (!ctx) throw new Error("useHostAuth requires HostAuthProvider");
  return ctx;
}
