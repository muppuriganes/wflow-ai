import type { Schedule, ScheduleCreateInput, ScheduleUpdateInput } from "@/types/api";
import { api } from "./api";

const base = (orgId: string) => `/organizations/${orgId}/schedules`;

export const schedulesApi = {
  list: (orgId: string) => api<Schedule[]>(base(orgId)),
  get: (orgId: string, id: string) => api<Schedule>(`${base(orgId)}/${id}`),
  create: (orgId: string, data: ScheduleCreateInput) =>
    api<Schedule>(base(orgId), { method: "POST", body: data }),
  update: (orgId: string, id: string, data: ScheduleUpdateInput) =>
    api<Schedule>(`${base(orgId)}/${id}`, { method: "PATCH", body: data }),
  pause: (orgId: string, id: string) =>
    api<Schedule>(`${base(orgId)}/${id}/pause`, { method: "POST" }),
  resume: (orgId: string, id: string) =>
    api<Schedule>(`${base(orgId)}/${id}/resume`, { method: "POST" }),
  trigger: (orgId: string, id: string) =>
    api<{ runs_started: number }>(`${base(orgId)}/${id}/trigger`, { method: "POST" }),
  delete: (orgId: string, id: string) =>
    api<void>(`${base(orgId)}/${id}`, { method: "DELETE" }),
};
