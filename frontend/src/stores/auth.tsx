import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onSessionChange, refreshSession, setAccessToken } from "@/services/api";
import { authApi } from "@/services/auth";
import type { TokenResponse, User } from "@/types/api";

type AuthState =
  | { status: "loading"; user: null }
  | { status: "authenticated"; user: User }
  | { status: "anonymous"; user: null };

type AuthContextValue = AuthState & {
  signIn: (session: TokenResponse) => void;
  signOut: () => Promise<void>;
  setUser: (user: User) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });

  const apply = useCallback((session: TokenResponse | null) => {
    setAccessToken(session?.access_token ?? null);
    setState(session ? { status: "authenticated", user: session.user } : { status: "anonymous", user: null });
  }, []);

  useEffect(() => {
    onSessionChange(apply);
    // Restore the session from the refresh cookie on page load.
    void refreshSession().then((session) => apply(session));
  }, [apply]);

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      apply(null);
      queryClient.clear();
    }
  }, [apply, queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      signIn: apply,
      signOut,
      setUser: (user) => setState({ status: "authenticated", user }),
    }),
    [state, apply, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
