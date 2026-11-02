import type { Plan, PlanUsageOverview } from "@/types/api";
import { api } from "./api";

const base = (orgId: string) => `/organizations/${orgId}/plans`;

export const plansApi = {
  list: (orgId: string) => api<Plan[]>(base(orgId)),
  getUsage: (orgId: string) => api<PlanUsageOverview>(`${base(orgId)}/usage`),
  changePlan: (orgId: string, data: { plan_key: string; billing_interval?: "monthly" | "yearly" }) =>
    api<PlanUsageOverview>(`${base(orgId)}/change`, { method: "POST", body: data }),
};

