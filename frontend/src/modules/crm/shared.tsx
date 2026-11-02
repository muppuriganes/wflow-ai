import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { Input, NativeSelect } from "@/components/ui/input";
import { crmApi } from "@/services/crm";
import { orgApi } from "@/services/organizations";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { LeadStage } from "@/types/api";
import { cn } from "@/utils/cn";

export const STAGES: { key: LeadStage; label: string }[] = [
  { key: "NEW", label: "New" },
  { key: "QUALIFIED", label: "Qualified" },
  { key: "CONTACTED", label: "Contacted" },
  { key: "PROPOSAL", label: "Proposal" },
  { key: "NEGOTIATION", label: "Negotiation" },
  { key: "CONVERTED", label: "Converted" },
  { key: "LOST", label: "Lost" },
];
export const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label])) as Record<LeadStage, string>;

export function formatMoney(amount: string | number | null, currency = "INR"): string {
  if (amount === null || amount === "") return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(amount));
  } catch {
    return `${currency} ${amount}`;
  }
}

/** Team members for owner/assignee pickers. */
export function useMembers() {
  const org = useCurrentOrg();
  return useQuery({
    queryKey: orgKeys.scoped(org.id, "members"),
    queryFn: () => orgApi.members(org.id),
    enabled: org.can("members.read"),
    staleTime: 60_000,
  });
}

export function MemberSelect({ value, onChange, placeholder = "Unassigned", ...rest }: {
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const members = useMembers();
  return (
    <NativeSelect value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} {...rest}>
      <option value="">{placeholder}</option>
      {members.data?.map((m) => (
        <option key={m.user_id} value={m.user_id}>
          {m.full_name}
        </option>
      ))}
    </NativeSelect>
  );
}

/** Search-as-you-type contact picker. */
export function ContactPicker({ value, onChange }: { value: { id: string; name: string } | null; onChange: (c: { id: string; name: string } | null) => void }) {
  const org = useCurrentOrg();
  const [q, setQ] = useState("");
  const results = useQuery({
    queryKey: orgKeys.scoped(org.id, "contacts", "picker", q),
    queryFn: () => crmApi.contacts(org.id, q, undefined, 1),
    enabled: !value,
    staleTime: 10_000,
  });
  if (value) {
    return (
      <div className="flex h-8 items-center justify-between rounded-md border border-border-strong bg-surface-muted px-2.5 text-[13px]">
        <span className="truncate font-medium">{value.name}</span>
        <button type="button" className="text-xs text-primary hover:underline" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-subtle" aria-hidden />
        <Input className="pl-8" placeholder="Search contacts…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search contacts" />
      </div>
      <ul className="max-h-40 overflow-y-auto rounded-md border">
        {results.data?.items.length ? (
          results.data.items.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={cn("flex w-full justify-between px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-muted")}
                onClick={() => onChange({ id: c.id, name: c.display_name ?? c.phone_number ?? "Contact" })}
              >
                <span className="truncate">{c.display_name ?? "—"}</span>
                <span className="font-mono text-xs text-muted">{c.phone_number ? `+${c.phone_number}` : c.email ?? ""}</span>
              </button>
            </li>
          ))
        ) : (
          <li className="px-2.5 py-2 text-xs text-muted">{results.isLoading ? "Searching…" : "No matching contacts"}</li>
        )}
      </ul>
    </div>
  );
}

/** <input type="datetime-local"> value ⇄ ISO string with the browser's timezone. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}
