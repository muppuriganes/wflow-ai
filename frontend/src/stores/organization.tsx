import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { orgApi } from "@/services/organizations";
import type { MyOrganization } from "@/types/api";

const STORAGE_KEY = "wflow.activeOrganization";

type OrgContextValue = {
  organizations: MyOrganization[];
  current: MyOrganization | null;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
  switchTo: (orgId: string) => void;
  /** UI convenience only — the API enforces every permission independently. */
  can: (permission: string) => boolean;
};

const OrgContext = createContext<OrgContextValue | null>(null);

export const orgKeys = {
  all: ["organizations"] as const,
  scoped: (orgId: string, ...rest: unknown[]) => ["org", orgId, ...rest] as const,
};

function readStoredOrg(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: orgKeys.all, queryFn: orgApi.list });
  const [selected, setSelected] = useState<string | null>(readStoredOrg);

  const organizations = useMemo(() => query.data ?? [], [query.data]);
  const current = organizations.find((o) => o.id === selected) ?? organizations[0] ?? null;

  const switchTo = useCallback(
    (orgId: string) => {
      setSelected(orgId);
      try {
        localStorage.setItem(STORAGE_KEY, orgId);
      } catch {
        // Storage may be unavailable (private mode); the selection still applies for this tab.
      }
      void queryClient.invalidateQueries({ queryKey: ["org"] });
    },
    [queryClient],
  );

  const value = useMemo<OrgContextValue>(
    () => ({
      organizations,
      current,
      isLoading: query.isLoading,
      error: query.error,
      refetch: () => void query.refetch(),
      switchTo,
      can: (permission) => current?.permissions.includes(permission) ?? false,
    }),
    [organizations, current, query, switchTo],
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrganization(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrganization must be used inside OrganizationProvider");
  return ctx;
}

/** For pages that only render once an organization is selected (guaranteed by AppLayout). */
export function useCurrentOrg(): MyOrganization & { can: (p: string) => boolean } {
  const { current, can } = useOrganization();
  if (!current) throw new Error("No active organization");
  return { ...current, can };
}
