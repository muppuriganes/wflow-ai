import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Inbox, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingRows } from "@/components/ui/states";
import { platformApi } from "@/services/admin";
import { errorMessage } from "@/services/api";
import type { OrgRequestItem } from "@/types/api";
import { cn } from "@/utils/cn";
import { formatDateTime, formatRelative } from "@/utils/format";

const TABS = [
  { key: "pending", label: "Waiting" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
] as const;

const DETAIL_LABELS: Record<string, string> = {
  business_type: "Business",
  phone: "Phone",
  team_size: "Team size",
  country: "Country",
  website: "Website",
  use_case: "Will use WFlow for",
};

export function AdminRequestsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("pending");
  const [approving, setApproving] = useState<OrgRequestItem | null>(null);
  const [rejecting, setRejecting] = useState<OrgRequestItem | null>(null);
  const requests = useQuery({ queryKey: ["admin", "requests", tab], queryFn: () => platformApi.requests(tab) });

  return (
    <>
      <PageHeader title="Organization requests" description="New businesses ask to join from the sign-up page. Nothing opens until you approve it." />
      <div className="mb-4 flex gap-1 border-b" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "-mb-px border-b-2 px-3 pb-2 text-[13px] font-medium",
              tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {requests.isLoading ? (
        <LoadingRows rows={4} />
      ) : requests.error ? (
        <ErrorState message={errorMessage(requests.error)} onRetry={() => void requests.refetch()} />
      ) : !requests.data?.length ? (
        <Card>
          <EmptyState icon={Inbox} title={tab === "pending" ? "No requests waiting" : "Nothing here"} description="New sign-ups appear here." />
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.data.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/admin/organizations/${r.id}`} className="text-sm font-semibold hover:underline">
                      {r.name}
                    </Link>
                    <span className="text-xs text-muted" title={formatDateTime(r.created_at)}>
                      requested {formatRelative(r.created_at)}
                    </span>
                  </div>
                  {r.requester && (
                    <p className="mt-0.5 text-xs text-muted">
                      {r.requester.full_name} · {r.requester.email}{" "}
                      <Badge tone={r.requester.email_verified ? "success" : "warning"}>
                        {r.requester.email_verified ? "email verified" : "email not verified"}
                      </Badge>
                    </p>
                  )}
                  <dl className="mt-3 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
                    {Object.entries(r.request_details).map(([k, v]) => (
                      <div key={k} className={cn("flex gap-2", k === "use_case" && "sm:col-span-2")}>
                        <dt className="w-32 shrink-0 text-muted">{DETAIL_LABELS[k] ?? k}</dt>
                        <dd className="min-w-0 break-words">{String(v)}</dd>
                      </div>
                    ))}
                    {!Object.keys(r.request_details).length && <p className="text-xs text-muted">No business details were given.</p>}
                  </dl>
                  {r.rejection_reason && <p className="mt-2 text-xs text-danger">Rejected: {r.rejection_reason}</p>}
                </div>
                {tab === "pending" && (
                  <div className="flex gap-2">
                    <Button variant="danger-outline" size="sm" onClick={() => setRejecting(r)}>
                      <X /> Reject
                    </Button>
                    <Button size="sm" onClick={() => setApproving(r)}>
                      <Check /> Approve
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      <ApproveDialog request={approving} onClose={() => setApproving(null)} />
      <RejectDialog request={rejecting} onClose={() => setRejecting(null)} />
    </>
  );
}

/** Shared by approval and the organization's Billing tab. */
export function BillingChoice({
  billingOn,
  setBillingOn,
  planKey,
  setPlanKey,
  trialDays,
  setTrialDays,
}: {
  billingOn: boolean;
  setBillingOn: (v: boolean) => void;
  planKey: string;
  setPlanKey: (v: string) => void;
  trialDays: string;
  setTrialDays: (v: string) => void;
}) {
  const plans = useQuery({ queryKey: ["admin", "plans"], queryFn: platformApi.plans, staleTime: Infinity });
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-1.5 text-xs font-medium">Billing</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { on: false, title: "Billing off", text: "You grant the plan. The organization pays nothing in the app." },
            { on: true, title: "Billing on", text: "The organization must add billing and pay to use the workspace." },
          ].map((o) => (
            <label
              key={String(o.on)}
              className={cn(
                "cursor-pointer rounded-md border p-3 text-[13px]",
                billingOn === o.on ? "border-primary bg-primary-soft/40" : "border-border-strong hover:bg-surface-muted",
              )}
            >
              <input type="radio" name="billing" className="sr-only" checked={billingOn === o.on} onChange={() => setBillingOn(o.on)} />
              <span className="font-medium">{o.title}</span>
              <span className="mt-0.5 block text-xs text-muted">{o.text}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label={billingOn ? "Suggested plan" : "Plan to grant"} hint={billingOn ? "They can choose another plan at checkout." : undefined}>
        <NativeSelect value={planKey} onChange={(e) => setPlanKey(e.target.value)}>
          {(plans.data ?? []).map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
              {p.price_cents_monthly ? ` — $${p.price_cents_monthly / 100}/month` : ""}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {billingOn && (
        <Field label="Free trial (days)" hint="Leave empty to require payment before the workspace opens.">
          <Input type="number" min={1} max={365} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />
        </Field>
      )}
    </div>
  );
}

function ApproveDialog({ request, onClose }: { request: OrgRequestItem | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [billingOn, setBillingOn] = useState(true);
  const [planKey, setPlanKey] = useState("growth");
  const [trialDays, setTrialDays] = useState("14");
  const approve = useMutation({
    mutationFn: () =>
      platformApi.approve(request!.id, {
        billing_required: billingOn,
        plan_key: planKey,
        trial_days: billingOn && trialDays ? Number(trialDays) : null,
      }),
    onSuccess: () => {
      toast.success(`${request?.name} approved — the owner has been emailed`);
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Dialog
      open={!!request}
      onOpenChange={(o) => !o && onClose()}
      size="md"
      title={`Approve ${request?.name ?? ""}`}
      description="Choose how this organization is billed. You can change it any time on its page."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => approve.mutate()} loading={approve.isPending}>
            Approve
          </Button>
        </>
      }
    >
      <BillingChoice
        billingOn={billingOn}
        setBillingOn={setBillingOn}
        planKey={planKey}
        setPlanKey={setPlanKey}
        trialDays={trialDays}
        setTrialDays={setTrialDays}
      />
    </Dialog>
  );
}

function RejectDialog({ request, onClose }: { request: OrgRequestItem | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const reject = useMutation({
    mutationFn: () => platformApi.reject(request!.id, reason.trim()),
    onSuccess: () => {
      toast.success(`${request?.name} rejected — the requester has been emailed`);
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
      setReason("");
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Dialog
      open={!!request}
      onOpenChange={(o) => !o && onClose()}
      title={`Reject ${request?.name ?? ""}`}
      description="The requester sees this reason in the app and in an email."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => reject.mutate()} loading={reject.isPending} disabled={reason.trim().length < 3}>
            Reject
          </Button>
        </>
      }
    >
      <Field label="Reason">
        <textarea
          className="min-h-24 w-full rounded-md border border-border-strong bg-surface px-2.5 py-2 text-[13px] focus-visible:border-primary focus-visible:outline-none"
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
    </Dialog>
  );
}
