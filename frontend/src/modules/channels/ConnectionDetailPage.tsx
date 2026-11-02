import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FlaskConical, History, LogOut, Play, RotateCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert, EmptyState, ErrorState, LoadingRows, Spinner } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, errorMessage } from "@/services/api";
import { channelsApi } from "@/services/channels";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { Connection } from "@/types/api";
import { formatDateTime } from "@/utils/format";
import { ConversationsPanel } from "./ConversationsPanel";
import { QrPanel } from "./QrPanel";
import { CAN_START, CHANNEL_LABELS, formatPhone, STATUS_META, TRANSITIONAL } from "./status";

const inboundSchema = z.object({
  phone: z.string().regex(/^\+?\d{6,15}$/, "Digits only, with country code"),
  name: z.string().trim().min(1, "Enter a name").max(100),
  text: z.string().trim().min(1, "Enter a message").max(4096),
  with_image: z.boolean(),
});

function SimulatorCard({ connection }: { connection: Connection }) {
  const org = useCurrentOrg();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "connection", connection.id) });
  const scan = useMutation({
    mutationFn: () => channelsApi.simulateScan(org.id, connection.id),
    onSuccess: () => setTimeout(() => void refresh(), 600),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const {
    register,
    handleSubmit,
    resetField,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof inboundSchema>>({
    resolver: zodResolver(inboundSchema),
    defaultValues: { phone: "919800000001", name: "Test Customer", text: "", with_image: false },
  });
  const onInbound = handleSubmit(async (values) => {
    try {
      await channelsApi.simulateInbound(org.id, connection.id, values);
      resetField("text");
      toast.success("Customer message sent to the simulator");
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "conversations") }), 600);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });

  return (
    <Card className="border-dashed">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <FlaskConical className="size-4 text-primary" aria-hidden /> Simulator controls
          </span>
        }
        description="Act as the phone and as a customer. Everything below goes through the real messaging pipeline."
      />
      <CardBody className="space-y-4">
        {connection.status === "QR_PENDING" && (
          <Button onClick={() => scan.mutate()} loading={scan.isPending}>
            Simulate QR scan
          </Button>
        )}
        {connection.status === "CONNECTED" ? (
          <form onSubmit={onInbound} noValidate className="grid gap-3 sm:grid-cols-[160px_160px_1fr_auto] sm:items-end">
            <Field label="Customer phone" error={errors.phone?.message}>
              <Input {...register("phone")} />
            </Field>
            <Field label="Customer name" error={errors.name?.message}>
              <Input {...register("name")} />
            </Field>
            <Field label="Message" error={errors.text?.message}>
              <Input placeholder="Hi, do you have this in stock?" {...register("text")} />
            </Field>
            <Button type="submit" variant="secondary" loading={isSubmitting}>
              Send as customer
            </Button>
            <label className="flex items-center gap-2 text-xs sm:col-span-4">
              <input type="checkbox" className="accent-[var(--color-primary)]" {...register("with_image")} />
              Attach a sample photo
            </label>
          </form>
        ) : (
          connection.status !== "QR_PENDING" && <p className="text-xs text-muted">Connect the simulator to send test customer messages.</p>
        )}
      </CardBody>
    </Card>
  );
}

function ActivityLog({ connection }: { connection: Connection }) {
  const org = useCurrentOrg();
  const [page, setPage] = useState(1);
  const events = useQuery({
    queryKey: orgKeys.scoped(org.id, "connection-events", connection.id, page, connection.status),
    queryFn: () => channelsApi.events(org.id, connection.id, page),
    placeholderData: keepPreviousData,
  });
  if (events.isLoading) return <LoadingRows />;
  if (events.error) return <ErrorState message={errorMessage(events.error)} onRetry={() => void events.refetch()} />;
  if (!events.data?.items.length) return <EmptyState icon={History} title="No activity yet" />;
  const pages = Math.ceil(events.data.total / events.data.page_size);
  return (
    <>
      <Table>
        <THead>
          <TR>
            <TH>Event</TH>
            <TH>Detail</TH>
            <TH className="w-48">When</TH>
          </TR>
        </THead>
        <TBody>
          {events.data.items.map((e) => (
            <TR key={e.id}>
              <TD className="font-medium">{e.summary}</TD>
              <TD className="text-xs text-muted">{typeof e.details.detail === "string" ? e.details.detail : "—"}</TD>
              <TD className="text-muted">{formatDateTime(e.occurred_at)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {pages > 1 && (
        <div className="flex justify-end gap-2 border-t px-4 py-2.5">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </>
  );
}

export function ConnectionDetailPage() {
  const { connectionId = "" } = useParams();
  const org = useCurrentOrg();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<"logout" | "remove" | null>(null);
  const key = orgKeys.scoped(org.id, "connection", connectionId);
  const connection = useQuery({
    queryKey: key,
    queryFn: () => channelsApi.get(org.id, connectionId),
    refetchInterval: (q) => (q.state.data && TRANSITIONAL.has(q.state.data.status) ? 2000 : 10000),
  });

  const onDone = (c?: Connection) => {
    if (c) queryClient.setQueryData(key, c);
    void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "connections") });
  };
  const start = useMutation({
    mutationFn: (c: Connection) => (c.status === "NOT_CONNECTED" || c.status === "LOGGED_OUT" ? channelsApi.initialize : channelsApi.reconnect)(org.id, c.id),
    onSuccess: onDone,
    onError: (err) => {
      toast.error(errorMessage(err));
      void connection.refetch();
    },
  });
  const logout = useMutation({
    mutationFn: () => channelsApi.logout(org.id, connectionId),
    onSuccess: (c) => {
      setConfirm(null);
      toast.success("Device unlinked");
      onDone(c);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => channelsApi.remove(org.id, connectionId),
    onSuccess: () => {
      toast.success("Channel removed and session data deleted");
      onDone();
      navigate("/channels");
    },
    onError: (err) => {
      setConfirm(null);
      toast.error(errorMessage(err));
    },
  });

  if (connection.isLoading) return <Spinner label="Loading channel" />;
  if (connection.error) {
    if (connection.error instanceof ApiError && connection.error.status === 404) {
      return (
        <Card>
          <EmptyState icon={History} title="Channel not found" action={<Button asChild variant="secondary"><Link to="/channels">Back to channels</Link></Button>} />
        </Card>
      );
    }
    return <ErrorState message={errorMessage(connection.error)} onRetry={() => void connection.refetch()} />;
  }
  const c = connection.data!;
  const meta = STATUS_META[c.status];
  const canManage = org.can("connections.manage");
  const showSetup = TRANSITIONAL.has(c.status);

  return (
    <>
      <Link to="/channels" className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden /> Channels
      </Link>
      <PageHeader
        title={c.display_name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {CHANNEL_LABELS[c.channel_type]} <StatusDot tone={meta.tone} label={meta.label} />
            {c.channel_type === "simulator" && <Badge>Test</Badge>}
          </span>
        }
        actions={
          canManage && (
            <>
              {CAN_START.has(c.status) && (
                <Button onClick={() => start.mutate(c)} loading={start.isPending}>
                  {c.status === "NOT_CONNECTED" || c.status === "LOGGED_OUT" ? <Play /> : <RotateCw />}
                  {c.status === "NOT_CONNECTED" ? "Connect" : c.status === "LOGGED_OUT" ? "Link again" : "Reconnect"}
                </Button>
              )}
              {(c.status === "CONNECTED" || showSetup) && (
                <Button variant="secondary" onClick={() => setConfirm("logout")}>
                  <LogOut /> {c.status === "CONNECTED" ? "Log out" : "Cancel"}
                </Button>
              )}
              <Button variant="danger-outline" size="icon" aria-label="Remove channel" onClick={() => setConfirm("remove")}>
                <Trash2 />
              </Button>
            </>
          )
        }
      />

      <div className="space-y-4">
        {c.status === "ERROR" && c.status_detail && <Alert tone="danger" title="Connection problem">{c.status_detail}</Alert>}
        {c.status === "DISCONNECTED" && (
          <Alert tone="warning" title="Disconnected">
            {c.status_detail ?? "The session dropped."} Messages are not received while disconnected. Use Reconnect to resume.
          </Alert>
        )}

        {showSetup && (
          <Card>
            <CardHeader title={c.status === "QR_PENDING" ? "Scan to link" : "Connecting"} />
            <QrPanel connection={c} />
          </Card>
        )}

        {c.channel_type === "simulator" && canManage && (c.status === "CONNECTED" || c.status === "QR_PENDING") && <SimulatorCard connection={c} />}

        <Card>
          <CardBody className="grid gap-4 text-[13px] sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted">Number</p>
              <p className="font-mono">{formatPhone(c.phone_number)}</p>
            </div>
            <div>
              <p className="text-xs text-muted">WhatsApp name</p>
              <p>{c.account_name ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Last connected</p>
              <p>{c.last_connected_at ? formatDateTime(c.last_connected_at) : "Never"}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Last disconnected</p>
              <p>{c.last_disconnected_at ? formatDateTime(c.last_disconnected_at) : "—"}</p>
            </div>
          </CardBody>
        </Card>

        <Tabs defaultValue="conversations">
          <TabsList>
            <TabsTrigger value="conversations">Conversations</TabsTrigger>
            <TabsTrigger value="activity">Connection log</TabsTrigger>
          </TabsList>
          <TabsContent value="conversations">
            <Card className="overflow-hidden">
              <ConversationsPanel connection={c} />
            </Card>
          </TabsContent>
          <TabsContent value="activity">
            <Card>
              <ActivityLog connection={c} />
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <ConfirmDialog
        open={confirm === "logout"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={c.status === "CONNECTED" ? `Log out ${c.display_name}?` : "Cancel linking?"}
        description="The linked device is removed from WhatsApp and the stored session is deleted. You can link again with a new QR code."
        confirmLabel={c.status === "CONNECTED" ? "Log out" : "Cancel linking"}
        danger
        loading={logout.isPending}
        onConfirm={() => logout.mutate()}
      />
      <ConfirmDialog
        open={confirm === "remove"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Remove ${c.display_name}?`}
        description="The device is logged out, its session data is permanently deleted from our servers, and the channel disappears from this list. Past conversations are kept."
        confirmLabel="Remove channel"
        danger
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
