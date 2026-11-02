import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ErrorState, LoadingRows } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { errorMessage } from "@/services/api";
import { billingApi } from "@/services/billing";
import { plansApi } from "@/services/plans";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { Plan, PlanUsageOverview } from "@/types/api";
import { formatDate } from "@/utils/format";

export function BillingPage() {
  const org = useCurrentOrg();
  const queryClient = useQueryClient();
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">("monthly");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [params, setParams] = useSearchParams();

  // Returning from a (test-mode) checkout: redeem it once, then tidy the address bar.
  const checkoutSession = params.get("checkout_session");
  const redeemed = useRef<string | null>(null);
  useEffect(() => {
    if (!checkoutSession || redeemed.current === checkoutSession) return;
    redeemed.current = checkoutSession;
    billingApi
      .confirmTestCheckout(org.id, checkoutSession)
      .then((sub) => {
        toast.success(`You're now on the ${sub.plan_name} plan`);
        void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "plans-usage") });
        void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "invoices") });
      })
      .catch((err: unknown) => toast.error(errorMessage(err)))
      .finally(() => {
        const next = new URLSearchParams(params);
        next.delete("checkout_session");
        setParams(next, { replace: true });
      });
  }, [checkoutSession, org.id, params, queryClient, setParams]);

  const usageQuery = useQuery({
    queryKey: orgKeys.scoped(org.id, "plans-usage"),
    queryFn: () => plansApi.getUsage(org.id),
    enabled: org.can("org.read"),
  });

  const plansQuery = useQuery({
    queryKey: orgKeys.scoped(org.id, "plans-list"),
    queryFn: () => plansApi.list(org.id),
    enabled: org.can("org.read"),
  });

  const invoicesQuery = useQuery({
    queryKey: orgKeys.scoped(org.id, "invoices"),
    queryFn: () => billingApi.listInvoices(org.id),
    enabled: org.can("billing.manage"),
  });

  // Billing off: the WFlow team arranges the plan, so there is nothing to buy or cancel here.
  const managed = !org.billing_required;
  const canManage = org.can("billing.manage") && !managed;


  const checkoutMutation = useMutation({
    mutationFn: (planKey: string) =>
      billingApi.createCheckout(org.id, {
        plan_key: planKey,
        billing_interval: billingInterval,
        return_url: window.location.origin + window.location.pathname,
      }),
    onSuccess: (res) => {
      if (res.checkout_url) {
        window.location.href = res.checkout_url;
      }
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const portalMutation = useMutation({
    mutationFn: () =>
      billingApi.createPortal(org.id, {
        return_url: window.location.href,
      }),
    onSuccess: (res) => {
      if (res.portal_url) {
        window.location.href = res.portal_url;
      }
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const cancelMutation = useMutation({
    mutationFn: () => billingApi.cancelSubscription(org.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "plans-usage") });
      toast.success("Subscription scheduled to cancel at end of billing cycle");
      setConfirmCancel(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const resumeMutation = useMutation({
    mutationFn: () => billingApi.resumeSubscription(org.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "plans-usage") });
      toast.success("Subscription resumed successfully");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (usageQuery.isLoading || plansQuery.isLoading) {
    return <LoadingRows rows={6} />;
  }

  if (usageQuery.error) {
    return <ErrorState message={errorMessage(usageQuery.error)} onRetry={() => void usageQuery.refetch()} />;
  }

  const usage = usageQuery.data as PlanUsageOverview;
  // With billing on, a paid plan is required.
  const plans = ((plansQuery.data || []) as Plan[]).filter((p) => managed || p.price_cents_monthly > 0);
  const currentPlan = usage?.plan;
  const currentSub = usage?.subscription;

  // Only a paid or trialing subscription is "current"; an unpaid one can still be checked out.
  const paying = currentSub?.status === "active" || currentSub?.status === "trialing";
  const isCurrentPlan = (plan: Plan) => paying && plan.id === currentPlan?.id;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Plans & Billing"
        description="Manage your subscription, monitor resource usage limits, and access past invoices."
        actions={
          canManage && (
            <Button
              variant="secondary"
              onClick={() => portalMutation.mutate()}
              disabled={portalMutation.isPending}
              className="gap-1.5"
            >
              <ExternalLink className="size-3.5" />
              {portalMutation.isPending ? "Opening…" : "Billing Portal"}
            </Button>
          )
        }
      />

      {managed && (
        <div className="rounded-lg border border-success/30 bg-success-soft/40 px-4 py-3 text-xs text-foreground">
          <span className="font-semibold text-success">Your plan is managed by the WFlow team.</span> There's nothing to pay in the app.
          To change your plan or limits, contact support.
        </div>
      )}

      {/* Stripe Test Mode Banner */}
      <div className={`items-center gap-3 rounded-lg border border-info/40 bg-info-soft/30 px-4 py-3 text-xs text-foreground ${managed ? "hidden" : "flex"}`}>
        <Sparkles className="size-4 shrink-0 text-info" />
        <div className="flex-1">
          <span className="font-semibold text-info">Test Billing Mode Active:</span> Stripe checkout and billing run
          in sandboxed test mode with mock payment sessions. No real charges will be made.
        </div>
      </div>

      {/* Current Plan & Subscription Card */}
      <Card>
        <CardHeader
          title={
            <div className="flex items-center gap-2">
              <span>Current Plan: {currentPlan?.name ?? "Free"}</span>
              <Badge
                tone={
                  currentSub?.status === "active"
                    ? "success"
                    : currentSub?.status === "trialing"
                      ? "warning"
                      : "neutral"
                }
              >
                {currentSub?.status === "trialing" ? "14-Day Free Trial" : currentSub?.status ?? "active"}
              </Badge>
              {currentSub?.cancel_at_period_end && (
                <Badge tone="danger">Canceling at period end</Badge>
              )}
            </div>
          }
          description={
            currentSub?.status === "trialing" ? (
              <span className="flex items-center gap-1.5 text-warning font-medium">
                <Clock className="size-3.5" />
                {usage?.trial_days_remaining !== null && usage?.trial_days_remaining !== undefined
                  ? `${usage.trial_days_remaining} day${usage.trial_days_remaining === 1 ? "" : "s"} remaining in trial`
                  : "Trial active"}
              </span>
            ) : managed ? (
              "Arranged by the WFlow team"
            ) : !paying ? (
              <span className="font-medium text-warning">Payment needed — choose a plan below to start</span>
            ) : (
              `Billed ${currentSub?.billing_interval ?? "monthly"} · Renews ${formatDate(currentSub?.current_period_end ?? "")}`
            )
          }
          actions={
            canManage &&
            (currentSub?.cancel_at_period_end ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => resumeMutation.mutate()}
                disabled={resumeMutation.isPending}
              >
                {resumeMutation.isPending ? "Resuming…" : "Resume Subscription"}
              </Button>
            ) : paying && currentSub?.status === "active" && currentPlan?.key !== "free" ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-danger hover:text-danger hover:bg-danger-soft/20 text-xs"
                onClick={() => setConfirmCancel(true)}
              >
                Cancel Subscription
              </Button>
            ) : null)
          }
        />
        <CardBody className="space-y-6">
          {/* Usage Meters */}
          <div>
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-4">Resource Usage</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {usage?.meters.map((meter) => {
                const isNearLimit = meter.percentage >= 85;
                const isOverLimit = meter.percentage >= 100;
                return (
                  <div key={meter.metric} className="rounded-lg border border-border/80 p-3.5 space-y-2">
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span className="text-muted">{meter.label}</span>
                      <span className="font-semibold text-foreground">
                        {meter.used.toLocaleString()} /{" "}
                        {meter.limit >= 999999 ? "Unlimited" : meter.limit.toLocaleString()}
                      </span>
                    </div>
                    {/* Progress Bar */}
                    <div className="h-2 w-full rounded-full bg-surface-muted overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          isOverLimit ? "bg-danger" : isNearLimit ? "bg-warning" : "bg-primary"
                        }`}
                        style={{ width: `${Math.min(meter.percentage, 100)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted">
                      <span>{Math.round(meter.percentage)}% used</span>
                      {isNearLimit && !isOverLimit && (
                        <span className="text-warning flex items-center gap-1 font-medium">
                          <AlertCircle className="size-3" /> Approaching limit
                        </span>
                      )}
                      {isOverLimit && (
                        <span className="text-danger flex items-center gap-1 font-semibold">
                          <ShieldAlert className="size-3" /> Limit reached
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Plan Selection Cards */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Available Subscription Plans</h2>
            <p className="text-xs text-muted">Scale your operations with higher throughput, more channels, and unlimited workflows.</p>
          </div>
          {/* Interval Toggle */}
          <div className="flex items-center rounded-lg border bg-surface p-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => setBillingInterval("monthly")}
              className={`rounded px-3 py-1.5 transition-colors ${
                billingInterval === "monthly" ? "bg-primary text-white font-semibold" : "text-muted hover:text-foreground"
              }`}
            >
              Monthly billing
            </button>
            <button
              type="button"
              onClick={() => setBillingInterval("yearly")}
              className={`rounded px-3 py-1.5 transition-colors flex items-center gap-1.5 ${
                billingInterval === "yearly" ? "bg-primary text-white font-semibold" : "text-muted hover:text-foreground"
              }`}
            >
              <span>Yearly billing</span>
              <span className="rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[10px] px-1.5 py-0.2 font-semibold">
                Save 17%
              </span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => {
            const current = isCurrentPlan(plan);
            const price =
              billingInterval === "yearly"
                ? Math.round(plan.price_cents_yearly / 1200)
                : Math.round(plan.price_cents_monthly / 100);

            return (
              <Card
                key={plan.id}
                className={`relative flex flex-col justify-between ${
                  current ? "border-primary ring-2 ring-primary/20 shadow-md" : ""
                }`}
              >
                <div>
                  <CardHeader
                    title={
                      <div className="flex items-center justify-between">
                        <span>{plan.name}</span>
                        {current && <Badge tone="info">Active</Badge>}
                      </div>
                    }
                    description={plan.description}
                  />
                  <CardBody className="space-y-4">
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold text-foreground">${price}</span>
                      <span className="text-xs text-muted">/ month</span>
                    </div>

                    <div className="border-t border-border/60 pt-4 space-y-2 text-xs">
                      <div className="font-semibold text-foreground text-[11px] uppercase tracking-wider">
                        Included Limits:
                      </div>
                      <ul className="space-y-1.5 text-muted">
                        <li className="flex items-center gap-2">
                          <Check className="size-3.5 text-primary shrink-0" />
                          <span>{plan.limits.max_members ?? 1} Team Member{(plan.limits.max_members ?? 1) > 1 ? "s" : ""}</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Check className="size-3.5 text-primary shrink-0" />
                          <span>{plan.limits.max_channels ?? 1} Channel Connection{(plan.limits.max_channels ?? 1) > 1 ? "s" : ""}</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Check className="size-3.5 text-primary shrink-0" />
                          <span>{plan.limits.max_workflows ?? 3} Active Workflows</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Check className="size-3.5 text-primary shrink-0" />
                          <span>{plan.limits.max_active_schedules ?? 1} Automation Schedule{(plan.limits.max_active_schedules ?? 1) > 1 ? "s" : ""}</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Check className="size-3.5 text-primary shrink-0" />
                          <span>{(plan.limits.max_monthly_runs ?? 100).toLocaleString()} Workflow Runs/mo</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Check className="size-3.5 text-primary shrink-0" />
                          <span>{(plan.limits.max_monthly_messages ?? 500).toLocaleString()} Messages/mo</span>
                        </li>
                      </ul>
                    </div>
                  </CardBody>
                </div>

                <CardFooter className="pt-2">
                  {current ? (
                    <Button variant="secondary" className="w-full text-xs" disabled>
                      <CheckCircle2 className="size-3.5 mr-1" /> Current Plan
                    </Button>
                  ) : canManage ? (
                    <Button
                      variant={plan.key === "free" ? "secondary" : "primary"}
                      className="w-full text-xs gap-1"
                      onClick={() => {
                        checkoutMutation.mutate(plan.key);
                      }}
                      disabled={checkoutMutation.isPending}
                    >
                      <span>Select {plan.name}</span>
                      <ArrowRight className="size-3" />
                    </Button>
                  ) : (
                    <Button variant="secondary" className="w-full text-xs" disabled>
                      {managed ? "Managed by WFlow" : "Owner Only"}
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Invoices Table */}
      {canManage && (
        <Card>
          <CardHeader
            title="Invoice History"
            description="Download PDF receipts and view statement histories for past billing cycles."
          />
          <CardBody>
            {invoicesQuery.isLoading ? (
              <LoadingRows rows={3} />
            ) : !invoicesQuery.data?.length ? (
              <div className="py-6 text-center text-xs text-muted">
                No invoices recorded yet. Invoices appear automatically after renewal or plan purchase.
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Invoice #</TH>
                    <TH>Billing Period</TH>
                    <TH>Date</TH>
                    <TH>Amount</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Receipt</TH>
                  </TR>
                </THead>
                <TBody>
                  {invoicesQuery.data.map((inv) => (
                    <TR key={inv.id}>
                      <TD className="font-mono font-medium">{inv.invoice_number}</TD>
                      <TD className="text-xs text-muted">
                        {formatDate(inv.period_start)} – {formatDate(inv.period_end)}
                      </TD>
                      <TD className="text-xs">{formatDate(inv.created_at)}</TD>
                      <TD className="font-semibold">
                        ${(inv.amount_cents / 100).toFixed(2)} {inv.currency.toUpperCase()}
                      </TD>
                      <TD>
                        <Badge tone={inv.status === "paid" ? "success" : "neutral"}>
                          {inv.status}
                        </Badge>
                      </TD>
                      <TD className="text-right">
                        {inv.pdf_url ? (
                          <a
                            href={inv.pdf_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            <Download className="size-3" />
                            PDF
                          </a>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      {/* Confirm Cancellation Dialog */}
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel Subscription?"
        description="Your organization will retain full access to current features until the end of this billing cycle. After that, your account will revert to the Free plan with standard limits."
        confirmLabel="Confirm Cancellation"
        danger
        onConfirm={() => cancelMutation.mutate()}
        loading={cancelMutation.isPending}
      />
    </div>
  );
}
