import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, FlaskConical, MessageCircle, MessageSquare, Plus, QrCode, Smartphone, Wifi } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Alert, EmptyState, ErrorState, LoadingRows } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { applyServerErrors } from "@/hooks/useServerErrors";
import { errorMessage } from "@/services/api";
import { channelsApi } from "@/services/channels";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { ChannelType } from "@/types/api";
import { cn } from "@/utils/cn";
import { formatRelative } from "@/utils/format";
import { CHANNEL_LABELS, formatPhone, STATUS_META, TRANSITIONAL } from "./status";

const schema = z
  .object({
    display_name: z.string().trim().min(2, "Use at least 2 characters").max(100),
    channel_type: z.enum(["whatsapp_web", "simulator"]),
    acknowledged: z.boolean(),
  })
  .refine((v) => v.channel_type !== "whatsapp_web" || v.acknowledged, {
    path: ["acknowledged"],
    message: "Please confirm you understand the limitations",
  });
type Values = z.infer<typeof schema>;

function AddConnectionDialog({ open, onOpenChange, channelTypes }: { open: boolean; onOpenChange: (o: boolean) => void; channelTypes: ChannelType[] }) {
  const org = useCurrentOrg();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { display_name: "", channel_type: "whatsapp_web", acknowledged: false },
  });
  const type = watch("channel_type");

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const conn = await channelsApi.create(org.id, values.display_name, values.channel_type);
      await queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "connections") });
      reset();
      onOpenChange(false);
      navigate(`/channels/${conn.id}`);
    } catch (err) {
      setFormError(applyServerErrors(err, setError, ["display_name", "channel_type"]));
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a messaging channel"
      description="Connect a WhatsApp number or test simulator your team will use to talk to customers."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="add-connection" loading={isSubmitting}>
            Add channel
          </Button>
        </>
      }
    >
      <form id="add-connection" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Field label="Channel Name" error={errors.display_name?.message} hint="Shown to your team, e.g. “Sales line” or “Customer Support”.">
          <Input autoFocus placeholder="e.g. Primary Support Line" {...register("display_name")} />
        </Field>
        <Field label="Channel Type" error={errors.channel_type?.message}>
          <NativeSelect {...register("channel_type")}>
            {channelTypes.map((t) => (
              <option key={t} value={t}>
                {CHANNEL_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {type === "whatsapp_web" ? (
          <div className="space-y-2.5 rounded-lg border border-warning/20 bg-warning-soft/30 p-3">
            <Alert tone="warning" title="Before you connect">
              This links WhatsApp Web through an unofficial client (whatsapp-web.js). WhatsApp may restrict or ban numbers
              used this way. Always test with a dedicated spare business number and respect customer opt-outs.
            </Alert>
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" className="mt-0.5 accent-[var(--color-primary)]" {...register("acknowledged")} />
              <span>I understand these limitations and will only message customers who explicitly opt in.</span>
            </label>
            {errors.acknowledged && (
              <p role="alert" className="text-xs text-danger font-medium">
                {errors.acknowledged.message}
              </p>
            )}
          </div>
        ) : (
          <Alert tone="info">
            The simulator behaves like a real WhatsApp number (QR scan, customer messages, delivery receipts) without a phone.
            Use it to try the product and to test automations.
          </Alert>
        )}
      </form>
    </Dialog>
  );
}

export function ChannelsPage() {
  const org = useCurrentOrg();
  const [addOpen, setAddOpen] = useState(false);
  const connections = useQuery({
    queryKey: orgKeys.scoped(org.id, "connections"),
    queryFn: () => channelsApi.list(org.id),
    refetchInterval: (q) => (q.state.data?.some((c) => TRANSITIONAL.has(c.status)) ? 3000 : 15000),
  });
  const caps = useQuery({ queryKey: orgKeys.scoped(org.id, "channel-caps"), queryFn: () => channelsApi.capabilities(org.id) });

  const canManage = org.can("connections.manage");
  const conns = connections.data ?? [];
  const maxConn = caps.data?.max_connections ?? 5;
  const atLimit = conns.length >= maxConn;

  const addButton = canManage && (
    <Button onClick={() => setAddOpen(true)} disabled={!caps.data || atLimit} title={atLimit ? "Connection limit reached" : undefined}>
      <Plus className="size-4" /> Add channel
    </Button>
  );

  if (!org.can("connections.read")) {
    return (
      <>
        <PageHeader title="Channels" />
        <Card>
          <EmptyState icon={MessageCircle} title="No access" description="Your role does not include viewing channels." />
        </Card>
      </>
    );
  }

  const connectedCount = conns.filter((c) => c.status === "CONNECTED").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Channels"
        description="Connect and manage WhatsApp phone numbers and simulators used for automated workflows and customer messaging."
        actions={addButton}
      />

      {/* Capacity & Health Banner */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4 shadow-card">
          <div className="flex items-center justify-between text-xs font-medium text-muted">
            <span>Connected Numbers</span>
            <Wifi className="size-4 text-emerald-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-foreground">
            {connectedCount} <span className="text-sm font-normal text-muted">active</span>
          </div>
          <div className="mt-1 text-xs text-muted">Ready to send and receive</div>
        </Card>

        <Card className="p-4 shadow-card">
          <div className="flex items-center justify-between text-xs font-medium text-muted">
            <span>Capacity Limit</span>
            <Smartphone className="size-4 text-primary" />
          </div>
          <div className="mt-2 text-2xl font-bold text-foreground">
            {conns.length} / {maxConn}
          </div>
          <div className="mt-2">
            <ProgressBar value={conns.length} max={maxConn} />
          </div>
        </Card>

        <Card className="p-4 shadow-card">
          <div className="flex items-center justify-between text-xs font-medium text-muted">
            <span>Channel Health</span>
            <StatusPill tone={connectedCount > 0 ? "success" : "neutral"} label={connectedCount > 0 ? "Online" : "Idle"} />
          </div>
          <div className="mt-2 text-2xl font-bold text-foreground">
            {conns.filter((c) => c.status === "QR_PENDING").length > 0 ? "QR Scan Pending" : connectedCount > 0 ? "Operational" : "No Live Devices"}
          </div>
          <div className="mt-1 text-xs text-muted">Real-time gateway connectivity</div>
        </Card>
      </div>

      {/* Channels List */}
      <Card className="shadow-card overflow-hidden">
        <CardHeader
          title="Configured Channels"
          description="Click any channel to view connection status, QR code scanner, live logs or simulator controls."
        />
        <CardBody className="p-0">
          {connections.isLoading ? (
            <div className="p-4">
              <LoadingRows rows={3} />
            </div>
          ) : connections.error ? (
            <div className="p-6">
              <ErrorState message={errorMessage(connections.error)} onRetry={() => void connections.refetch()} />
            </div>
          ) : !conns.length ? (
            <div className="p-8">
              <EmptyState
                icon={Smartphone}
                title="No channels connected yet"
                description="Connect a WhatsApp number by scanning a QR code, or create a test simulator to try automations immediately."
                action={addButton || undefined}
              />
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {conns.map((c) => {
                const meta = STATUS_META[c.status];
                const isConnected = c.status === "CONNECTED";
                const isQrWaiting = c.status === "QR_PENDING";

                return (
                  <div
                    key={c.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 transition-colors hover:bg-surface-muted/40"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div
                        className={cn(
                          "flex size-11 shrink-0 items-center justify-center rounded-xl",
                          c.channel_type === "simulator"
                            ? "bg-amber-100 text-amber-700"
                            : isConnected
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-surface-muted text-muted"
                        )}
                      >
                        {c.channel_type === "simulator" ? (
                          <FlaskConical className="size-5" />
                        ) : (
                          <MessageSquare className="size-5" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Link to={`/channels/${c.id}`} className="truncate font-semibold text-foreground text-sm hover:text-primary hover:underline">
                            {c.display_name}
                          </Link>
                          {c.channel_type === "simulator" ? (
                            <Badge tone="neutral" className="text-[10px]">Simulator</Badge>
                          ) : (
                            <Badge tone="primary" className="text-[10px]">WhatsApp Web</Badge>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted">
                          <span className="font-mono">{formatPhone(c.phone_number)}</span>
                          <span>·</span>
                          <span>Last connected: {c.last_connected_at ? formatRelative(c.last_connected_at) : "Never"}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-center shrink-0">
                      <StatusPill
                        tone={isConnected ? "success" : isQrWaiting ? "warning" : "neutral"}
                        label={meta.label}
                      />

                      <Button asChild variant="secondary" size="sm" className="gap-1.5">
                        <Link to={`/channels/${c.id}`}>
                          {isQrWaiting ? (
                            <>
                              <QrCode className="size-3.5 text-primary" /> Scan QR
                            </>
                          ) : (
                            <>
                              Configure <ChevronRight className="size-3.5" />
                            </>
                          )}
                        </Link>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {caps.data && <AddConnectionDialog open={addOpen} onOpenChange={setAddOpen} channelTypes={caps.data.channel_types} />}
    </div>
  );
}
