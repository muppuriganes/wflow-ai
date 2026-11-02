import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Plus, Smartphone } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Alert, EmptyState, ErrorState, LoadingRows } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { applyServerErrors } from "@/hooks/useServerErrors";
import { errorMessage } from "@/services/api";
import { channelsApi } from "@/services/channels";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { ChannelType } from "@/types/api";
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
      title="Add a channel"
      description="Connect a WhatsApp number your team will use to talk to customers."
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
        <Field label="Name" error={errors.display_name?.message} hint="Shown to your team, e.g. “Sales line” or “Support”.">
          <Input autoFocus {...register("display_name")} />
        </Field>
        <Field label="Channel" error={errors.channel_type?.message}>
          <NativeSelect {...register("channel_type")}>
            {channelTypes.map((t) => (
              <option key={t} value={t}>
                {CHANNEL_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {type === "whatsapp_web" ? (
          <div className="space-y-2">
            <Alert tone="warning" title="Before you connect">
              This links WhatsApp Web through an unofficial client (whatsapp-web.js). WhatsApp may restrict or ban numbers
              used this way, and the connection can stop working when WhatsApp changes. Use a number you can afford to lose,
              message only customers who contacted you, and honour opt-out requests.
            </Alert>
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" className="mt-0.5 accent-[var(--color-primary)]" {...register("acknowledged")} />
              <span>I understand these limitations and will only message customers who contacted us.</span>
            </label>
            {errors.acknowledged && (
              <p role="alert" className="text-xs text-danger">
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
  const atLimit = (connections.data?.length ?? 0) >= (caps.data?.max_connections ?? Infinity);
  const addButton = canManage && (
    <Button onClick={() => setAddOpen(true)} disabled={!caps.data || atLimit} title={atLimit ? "Connection limit reached" : undefined}>
      <Plus /> Add channel
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

  return (
    <>
      <PageHeader
        title="Channels"
        description={
          caps.data
            ? `Messaging numbers connected to ${org.name} · ${connections.data?.length ?? 0} of ${caps.data.max_connections} used`
            : `Messaging numbers connected to ${org.name}`
        }
        actions={addButton}
      />
      <Card>
        {connections.isLoading ? (
          <LoadingRows />
        ) : connections.error ? (
          <ErrorState message={errorMessage(connections.error)} onRetry={() => void connections.refetch()} />
        ) : !connections.data?.length ? (
          <EmptyState
            icon={Smartphone}
            title="No channels yet"
            description="Connect a WhatsApp number by scanning a QR code, or start with the simulator to try things out."
            action={addButton || undefined}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Channel</TH>
                <TH className="w-40">Number</TH>
                <TH className="w-44">Status</TH>
                <TH className="w-40">Last connected</TH>
              </TR>
            </THead>
            <TBody>
              {connections.data.map((c) => (
                <TR key={c.id} className="hover:bg-surface-muted/50">
                  <TD>
                    <Link to={`/channels/${c.id}`} className="font-medium hover:text-primary">
                      {c.display_name}
                    </Link>
                    <p className="text-xs text-muted">{CHANNEL_LABELS[c.channel_type]}</p>
                  </TD>
                  <TD className="font-mono text-xs">{formatPhone(c.phone_number)}</TD>
                  <TD>
                    <StatusDot tone={STATUS_META[c.status].tone} label={STATUS_META[c.status].label} />
                    {c.channel_type === "simulator" && <Badge className="ml-2">Test</Badge>}
                  </TD>
                  <TD className="text-muted">{c.last_connected_at ? formatRelative(c.last_connected_at) : "Never"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {caps.data && <AddConnectionDialog open={addOpen} onOpenChange={setAddOpen} channelTypes={caps.data.channel_types} />}
    </>
  );
}
