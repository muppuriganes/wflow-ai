import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  KeyRound,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Webhook as WebhookIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingRows } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage } from "@/services/api";
import { integrationsApi } from "@/services/integrations";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type {
  IntegrationCredential,
  WebhookCreateOut,
  WebhookEndpoint,
} from "@/types/api";
import { formatDate } from "@/utils/format";

const AVAILABLE_WEBHOOK_EVENTS = [
  { id: "message.received", label: "Message Received (Inbound)" },
  { id: "message.sent", label: "Message Sent (Outbound)" },
  { id: "contact.created", label: "Contact Created" },
  { id: "lead.stage_changed", label: "Lead Stage Changed" },
  { id: "workflow.run.completed", label: "Workflow Run Completed" },
  { id: "workflow.run.failed", label: "Workflow Run Failed" },
];

export function IntegrationsPage() {
  const org = useCurrentOrg();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("webhooks");

  // Webhooks State
  const [createWebhookOpen, setCreateWebhookOpen] = useState(false);
  const [secretModal, setSecretModal] = useState<WebhookCreateOut | null>(null);
  const [viewDeliveriesWebhook, setViewDeliveriesWebhook] = useState<WebhookEndpoint | null>(null);
  const [deleteWebhookTarget, setDeleteWebhookTarget] = useState<WebhookEndpoint | null>(null);

  // Form State: Create Webhook
  const [hookName, setHookName] = useState("");
  const [hookUrl, setHookUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["message.received"]);

  // Credentials State
  const [createCredOpen, setCreateCredOpen] = useState(false);
  const [credName, setCredName] = useState("");
  const [credType, setCredType] = useState<"api_key" | "bearer" | "basic">("bearer");
  const [credSecret, setCredSecret] = useState("");
  const [deleteCredTarget, setDeleteCredTarget] = useState<IntegrationCredential | null>(null);

  const canManage = org.can("integrations.manage");

  // Queries
  const webhooksQuery = useQuery({
    queryKey: orgKeys.scoped(org.id, "webhooks"),
    queryFn: () => integrationsApi.listWebhooks(org.id),
    enabled: org.can("integrations.read"),
  });

  const credentialsQuery = useQuery({
    queryKey: orgKeys.scoped(org.id, "credentials"),
    queryFn: () => integrationsApi.listCredentials(org.id),
    enabled: org.can("integrations.read"),
  });

  const deliveriesQuery = useQuery({
    queryKey: orgKeys.scoped(org.id, "webhook-deliveries", viewDeliveriesWebhook?.id ?? ""),
    queryFn: () =>
      viewDeliveriesWebhook ? integrationsApi.listDeliveries(org.id, viewDeliveriesWebhook.id) : [],
    enabled: !!viewDeliveriesWebhook,
  });

  // Mutations
  const createWebhookMutation = useMutation({
    mutationFn: () =>
      integrationsApi.createWebhook(org.id, {
        name: hookName.trim(),
        target_url: hookUrl.trim(),
        events: selectedEvents,
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "webhooks") });
      setCreateWebhookOpen(false);
      setHookName("");
      setHookUrl("");
      setSelectedEvents(["message.received"]);
      setSecretModal(res);
      toast.success("Webhook created successfully");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const deleteWebhookMutation = useMutation({
    mutationFn: (id: string) => integrationsApi.deleteWebhook(org.id, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "webhooks") });
      setDeleteWebhookTarget(null);
      toast.success("Webhook deleted");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const pingMutation = useMutation({
    mutationFn: (id: string) => integrationsApi.pingWebhook(org.id, id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(`Ping succeeded (HTTP ${res.status_code}, ${res.duration_ms}ms)`);
      } else {
        toast.error(`Ping failed: ${res.error || `HTTP ${res.status_code}`}`);
      }
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const redeliverMutation = useMutation({
    mutationFn: (deliveryId: string) =>
      integrationsApi.redeliver(org.id, viewDeliveriesWebhook!.id, deliveryId),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({
        queryKey: orgKeys.scoped(org.id, "webhook-deliveries", viewDeliveriesWebhook?.id ?? ""),
      });
      if (res.success) {
        toast.success(`Redelivery succeeded (HTTP ${res.status_code})`);
      } else {
        toast.error(`Redelivery failed: ${res.error || `HTTP ${res.status_code}`}`);
      }
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const createCredMutation = useMutation({
    mutationFn: () =>
      integrationsApi.createCredential(org.id, {
        name: credName.trim(),
        type: credType,
        secret: credSecret.trim(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "credentials") });
      setCreateCredOpen(false);
      setCredName("");
      setCredSecret("");
      toast.success("Credential encrypted and saved");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const deleteCredMutation = useMutation({
    mutationFn: (id: string) => integrationsApi.deleteCredential(org.id, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "credentials") });
      setDeleteCredTarget(null);
      toast.success("Credential deleted");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const toggleEventSelection = (eventId: string) => {
    setSelectedEvents((prev) =>
      prev.includes(eventId) ? prev.filter((e) => e !== eventId) : [...prev, eventId],
    );
  };

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations & Webhooks"
        description="Connect WFlow AI to external CRM, ERP, and API endpoints using signed outgoing webhooks and encrypted credentials."
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="webhooks" className="gap-2">
            <WebhookIcon className="size-4" />
            <span>Outgoing Webhooks</span>
            {webhooksQuery.data && (
              <Badge tone="neutral" className="ml-1 text-[10px]">
                {webhooksQuery.data.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="credentials" className="gap-2">
            <KeyRound className="size-4" />
            <span>Encrypted Credentials</span>
            {credentialsQuery.data && (
              <Badge tone="neutral" className="ml-1 text-[10px]">
                {credentialsQuery.data.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: Outgoing Webhooks */}
        <TabsContent value="webhooks" className="space-y-4 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Configured Webhook Endpoints</h2>
              <p className="text-xs text-muted">
                WFlow sends an HMAC-SHA256 signed JSON payload to your URLs when events occur.
              </p>
            </div>
            {canManage && (
              <Button size="sm" onClick={() => setCreateWebhookOpen(true)} className="gap-1.5 text-xs">
                <Plus className="size-3.5" />
                Add Webhook
              </Button>
            )}
          </div>

          {webhooksQuery.isLoading ? (
            <LoadingRows rows={4} />
          ) : webhooksQuery.error ? (
            <ErrorState message={errorMessage(webhooksQuery.error)} onRetry={() => void webhooksQuery.refetch()} />
          ) : !webhooksQuery.data?.length ? (
            <EmptyState
              icon={WebhookIcon}
              title="No webhooks configured"
              description="Deliver real-time event notifications to Zapier, Make, n8n, or your custom API."
              action={
                canManage && (
                  <Button size="sm" onClick={() => setCreateWebhookOpen(true)} className="gap-1.5">
                    <Plus className="size-3.5" />
                    Create First Webhook
                  </Button>
                )
              }
            />
          ) : (
            <Card>
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>Target Endpoint</TH>
                    <TH>Subscribed Events</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {webhooksQuery.data.map((wh) => (
                    <TR key={wh.id}>
                      <TD className="font-medium text-foreground">
                        <div>{wh.name}</div>
                        <div className="text-[11px] text-muted font-normal">
                          Created {formatDate(wh.created_at)}
                        </div>
                      </TD>
                      <TD className="font-mono text-xs max-w-xs truncate" title={wh.target_url}>
                        {wh.target_url}
                      </TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          {wh.events.map((ev) => (
                            <Badge key={ev} tone="neutral" className="text-[10px]">
                              {ev}
                            </Badge>
                          ))}
                        </div>
                      </TD>
                      <TD>
                        {!wh.is_active ? (
                          <Badge tone="danger">
                            Disabled {wh.disabled_reason ? `(${wh.disabled_reason})` : ""}
                          </Badge>
                        ) : wh.consecutive_failures > 0 ? (
                          <Badge tone="warning">
                            {wh.consecutive_failures} failure{wh.consecutive_failures > 1 ? "s" : ""}
                          </Badge>
                        ) : (
                          <Badge tone="success">Active</Badge>
                        )}
                      </TD>
                      <TD className="text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs px-2 gap-1"
                            onClick={() => pingMutation.mutate(wh.id)}
                            disabled={pingMutation.isPending}
                            title="Send ping event"
                          >
                            <Play className="size-3" />
                            Ping
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs px-2"
                            onClick={() => setViewDeliveriesWebhook(wh)}
                          >
                            Logs
                          </Button>
                          {canManage && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs px-2 text-danger hover:text-danger hover:bg-danger-soft/20"
                              onClick={() => setDeleteWebhookTarget(wh)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        {/* TAB 2: Encrypted Credentials */}
        <TabsContent value="credentials" className="space-y-4 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">API Credentials & Keys</h2>
              <p className="text-xs text-muted">
                Secrets are encrypted with AES-256-GCM. Injected securely into Workflow HTTP Request nodes without exposing values to logs.
              </p>
            </div>
            {canManage && (
              <Button size="sm" onClick={() => setCreateCredOpen(true)} className="gap-1.5 text-xs">
                <Plus className="size-3.5" />
                Add Credential
              </Button>
            )}
          </div>

          {credentialsQuery.isLoading ? (
            <LoadingRows rows={3} />
          ) : credentialsQuery.error ? (
            <ErrorState message={errorMessage(credentialsQuery.error)} onRetry={() => void credentialsQuery.refetch()} />
          ) : !credentialsQuery.data?.length ? (
            <EmptyState
              icon={KeyRound}
              title="No credentials stored"
              description="Store Bearer tokens or API keys to authenticate outbound HTTP action steps in your workflows."
              action={
                canManage && (
                  <Button size="sm" onClick={() => setCreateCredOpen(true)} className="gap-1.5">
                    <Plus className="size-3.5" />
                    Add First Credential
                  </Button>
                )
              }
            />
          ) : (
            <Card>
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>Auth Type</TH>
                    <TH>Masked Secret</TH>
                    <TH>Added On</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {credentialsQuery.data.map((cred) => (
                    <TR key={cred.id}>
                      <TD className="font-medium text-foreground">{cred.name}</TD>
                      <TD>
                        <Badge tone="neutral" className="uppercase text-[10px]">
                          {cred.type.replace("_", " ")}
                        </Badge>
                      </TD>
                      <TD className="font-mono text-xs text-muted">{cred.masked_secret}</TD>
                      <TD className="text-xs text-muted">{formatDate(cred.created_at)}</TD>
                      <TD className="text-right">
                        {canManage && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs px-2 text-danger hover:text-danger hover:bg-danger-soft/20"
                            onClick={() => setDeleteCredTarget(cred)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* DIALOG: Create Webhook */}
      <Dialog
        open={createWebhookOpen}
        onOpenChange={setCreateWebhookOpen}
        title="Add Outgoing Webhook"
        description="Deliver event payloads to an external HTTP server with signature verification."
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateWebhookOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createWebhookMutation.mutate()}
              disabled={
                !hookName.trim() ||
                !hookUrl.trim() ||
                !selectedEvents.length ||
                createWebhookMutation.isPending
              }
            >
              {createWebhookMutation.isPending ? "Creating…" : "Create Webhook"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Endpoint Name" hint="Human-friendly identifier">
            <Input
              value={hookName}
              onChange={(e) => setHookName(e.target.value)}
              placeholder="e.g. Production CRM Sync"
            />
          </Field>

          <Field label="Target URL" hint="HTTPS destination endpoint">
            <Input
              value={hookUrl}
              onChange={(e) => setHookUrl(e.target.value)}
              placeholder="https://api.yourdomain.com/webhooks/wflow"
            />
          </Field>

          <Field label="Subscribe to Events" hint="Select which events trigger this webhook">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 pt-1">
              {AVAILABLE_WEBHOOK_EVENTS.map((ev) => {
                const checked = selectedEvents.includes(ev.id);
                return (
                  <label
                    key={ev.id}
                    className={`flex items-center gap-2 rounded border p-2 text-xs cursor-pointer transition-colors ${
                      checked
                        ? "border-primary bg-primary-soft/30 text-foreground font-medium"
                        : "border-border/80 text-muted hover:border-border"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleEventSelection(ev.id)}
                      className="rounded border-border text-primary focus:ring-primary"
                    />
                    <span>{ev.label}</span>
                  </label>
                );
              })}
            </div>
          </Field>
        </div>
      </Dialog>

      {/* DIALOG: One-time Secret Display */}
      <Dialog
        open={!!secretModal}
        onOpenChange={() => setSecretModal(null)}
        title="Webhook Signing Secret"
        description="Copy this secret key immediately. It will never be shown again!"
        size="sm"
        footer={
          <Button onClick={() => setSecretModal(null)} className="w-full">
            I have saved the secret
          </Button>
        }
      >
        {secretModal && (
          <div className="space-y-4">
            <div className="rounded border border-warning/40 bg-warning-soft/30 p-3 text-xs text-foreground">
              Verify requests with header <code className="font-mono font-semibold">X-WFlow-Signature</code> (HMAC-SHA256).
            </div>
            <div className="flex items-center gap-2 rounded border bg-surface-muted p-2 font-mono text-xs">
              <span className="flex-1 truncate select-all">{secretModal.secret_key}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => copyToClipboard(secretModal.secret_key)}
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* DIALOG: Delivery History Modal */}
      <Dialog
        open={!!viewDeliveriesWebhook}
        onOpenChange={() => setViewDeliveriesWebhook(null)}
        title={`Deliveries · ${viewDeliveriesWebhook?.name ?? ""}`}
        description="Audit log of recent delivery attempts, response codes, and errors."
        size="lg"
        footer={
          <Button variant="secondary" onClick={() => setViewDeliveriesWebhook(null)}>
            Close
          </Button>
        }
      >
        {deliveriesQuery.isLoading ? (
          <LoadingRows rows={4} />
        ) : !deliveriesQuery.data?.length ? (
          <div className="py-8 text-center text-xs text-muted">
            No deliveries recorded yet. Deliveries will appear here as events trigger.
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Event</TH>
                  <TH>HTTP Status</TH>
                  <TH>Latency</TH>
                  <TH>Timestamp</TH>
                  <TH className="text-right">Action</TH>
                </TR>
              </THead>
              <TBody>
                {deliveriesQuery.data.map((del) => (
                  <TR key={del.id}>
                    <TD className="font-medium text-xs">
                      <div>{del.event_type}</div>
                      {del.error && (
                        <div className="text-[11px] text-danger max-w-xs truncate" title={del.error}>
                          {del.error}
                        </div>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={del.success ? "success" : "danger"}>
                        {del.response_status ? `HTTP ${del.response_status}` : "Failed"}
                      </Badge>
                    </TD>
                    <TD className="text-xs text-muted">
                      {del.duration_ms ? `${del.duration_ms}ms` : "—"}
                    </TD>
                    <TD className="text-xs text-muted">{formatDate(del.created_at)}</TD>
                    <TD className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs px-2 gap-1"
                        onClick={() => redeliverMutation.mutate(del.id)}
                        disabled={redeliverMutation.isPending}
                      >
                        <RefreshCw className="size-3" />
                        Retry
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Dialog>

      {/* DIALOG: Create Credential */}
      <Dialog
        open={createCredOpen}
        onOpenChange={setCreateCredOpen}
        title="Store Encrypted Credential"
        description="Add a protected API key or Bearer token for outbound requests."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateCredOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createCredMutation.mutate()}
              disabled={!credName.trim() || !credSecret.trim() || createCredMutation.isPending}
            >
              {createCredMutation.isPending ? "Encrypting…" : "Save Secret"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Credential Name" hint="Used to select this secret in workflow nodes">
            <Input
              value={credName}
              onChange={(e) => setCredName(e.target.value)}
              placeholder="e.g. OpenAI Key, SendGrid API"
            />
          </Field>

          <Field label="Credential Type">
            <NativeSelect
              value={credType}
              onChange={(e) => setCredType(e.target.value as "api_key" | "bearer" | "basic")}
            >
              <option value="bearer">Bearer Token (Authorization: Bearer ...)</option>
              <option value="api_key">API Key (X-API-Key: ...)</option>
              <option value="basic">Basic Auth (base64 username:password)</option>
            </NativeSelect>
          </Field>

          <Field label="Secret Value" hint="Encrypted with AES-256-GCM before saving">
            <Input
              type="password"
              value={credSecret}
              onChange={(e) => setCredSecret(e.target.value)}
              placeholder="Paste raw secret token"
            />
          </Field>
        </div>
      </Dialog>

      {/* Confirm Webhook Deletion */}
      <ConfirmDialog
        open={!!deleteWebhookTarget}
        onOpenChange={() => setDeleteWebhookTarget(null)}
        title="Delete Webhook Endpoint?"
        description={`Are you sure you want to delete "${deleteWebhookTarget?.name}"? Future event notifications will no longer be delivered to this URL.`}
        confirmLabel="Delete Webhook"
        danger
        onConfirm={() => {
          if (deleteWebhookTarget) deleteWebhookMutation.mutate(deleteWebhookTarget.id);
        }}
        loading={deleteWebhookMutation.isPending}
      />

      {/* Confirm Credential Deletion */}
      <ConfirmDialog
        open={!!deleteCredTarget}
        onOpenChange={() => setDeleteCredTarget(null)}
        title="Delete Encrypted Credential?"
        description={`Are you sure you want to delete "${deleteCredTarget?.name}"? Any workflows depending on this credential will fail.`}
        confirmLabel="Delete Credential"
        danger
        onConfirm={() => {
          if (deleteCredTarget) deleteCredMutation.mutate(deleteCredTarget.id);
        }}
        loading={deleteCredMutation.isPending}
      />
    </div>
  );
}
