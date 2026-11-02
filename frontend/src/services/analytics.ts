import type { AnalyticsData, AnalyticsOverview } from "@/types/api";
import { api } from "./api";

const base = (orgId: string) => `/organizations/${orgId}/analytics`;

export type AnalyticsParams = {
  range?: string;
  from_date?: string;
  to_date?: string;
};

function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

export const analyticsApi = {
  overview: (orgId: string) => api<AnalyticsOverview>(`${base(orgId)}/overview`),
  get: (orgId: string, params: AnalyticsParams = {}) =>
    api<AnalyticsData>(`${base(orgId)}${query(params)}`),
  exportUrl: (orgId: string, type = "conversations", range = "30d") =>
    `/api/v1/organizations/${orgId}/analytics/export?type=${encodeURIComponent(type)}&range=${encodeURIComponent(range)}`,
};

