import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Monitor } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingRows } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { applyServerErrors } from "@/hooks/useServerErrors";
import { passwordSchema } from "@/modules/auth/schemas";
import { errorMessage } from "@/services/api";
import { authApi } from "@/services/auth";
import { orgApi } from "@/services/organizations";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { AuditLog, Page } from "@/types/api";
import { describeUserAgent, formatDateTime, formatRelative } from "@/utils/format";

const passwordForm = z
  .object({ current_password: z.string().min(1, "Enter your current password"), new_password: passwordSchema, confirm: z.string() })
  .refine((v) => v.new_password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });
type PasswordValues = z.infer<typeof passwordForm>;

function ChangePasswordCard() {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PasswordValues>({
    resolver: zodResolver(passwordForm),
    defaultValues: { current_password: "", new_password: "", confirm: "" },
  });
  const onSubmit = handleSubmit(async (v) => {
    try {
      await authApi.changePassword(v.current_password, v.new_password);
      reset();
      toast.success("Password changed. Other sessions were signed out.");
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    } catch (err) {
      const message = applyServerErrors(err, setError, ["current_password", "new_password"]);
      if (message) setError("current_password", { message });
    }
  });
  return (
    <Card>
      <CardHeader title="Password" description="Changing your password signs out every other session." />
      <form onSubmit={onSubmit} noValidate>
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field label="Current password" error={errors.current_password?.message}>
            <Input type="password" autoComplete="current-password" {...register("current_password")} />
          </Field>
          <Field label="New password" error={errors.new_password?.message}>
            <Input type="password" autoComplete="new-password" {...register("new_password")} />
          </Field>
          <Field label="Confirm new password" error={errors.confirm?.message}>
            <Input type="password" autoComplete="new-password" {...register("confirm")} />
          </Field>
        </CardBody>
        <CardFooter>
          <Button type="submit" loading={isSubmitting}>
            Update password
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function SessionsCard() {
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: authApi.sessions });
  const revoke = useMutation({
    mutationFn: authApi.revokeSession,
    onSuccess: () => {
      toast.success("Session signed out");
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Card>
      <CardHeader title="Active sessions" description="Devices currently signed in to your account." />
      {sessions.isLoading ? (
        <LoadingRows rows={2} />
      ) : sessions.error ? (
        <ErrorState message={errorMessage(sessions.error)} onRetry={() => void sessions.refetch()} />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Device</TH>
              <TH className="w-36">IP address</TH>
              <TH className="w-40">Signed in</TH>
              <TH className="w-40">Last active</TH>
              <TH className="w-24">
                <span className="sr-only">Actions</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {sessions.data?.map((s) => (
              <TR key={s.id}>
                <TD>
                  <span className="inline-flex items-center gap-2">
                    <Monitor className="size-4 text-muted" aria-hidden />
                    {describeUserAgent(s.user_agent)}
                    {s.current && <Badge tone="success">This device</Badge>}
                  </span>
                </TD>
                <TD className="font-mono text-xs text-muted">{s.ip_address ?? "—"}</TD>
                <TD className="text-muted">{formatDateTime(s.created_at)}</TD>
                <TD className="text-muted">{s.last_used_at ? formatRelative(s.last_used_at) : "—"}</TD>
                <TD className="text-right">
                  {!s.current && (
                    <Button variant="ghost" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(s.id)}>
                      Sign out
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

function humanizeAction(action: string): string {
  return action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function AuditTable({ data, showActor }: { data: Page<AuditLog>; showActor: boolean }) {
  if (!data.items.length) return <EmptyState icon={History} title="No events yet" />;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Event</TH>
          {showActor && <TH className="w-56">By</TH>}
          <TH className="w-36">IP address</TH>
          <TH className="w-44">When</TH>
        </TR>
      </THead>
      <TBody>
        {data.items.map((log) => (
          <TR key={log.id}>
            <TD>
              <span className="font-medium">{humanizeAction(log.action)}</span>
              {typeof log.details.email === "string" && <span className="ml-2 text-xs text-muted">{log.details.email}</span>}
            </TD>
            {showActor && <TD className="text-muted">{log.actor_email ?? "System"}</TD>}
            <TD className="font-mono text-xs text-muted">{log.ip_address ?? "—"}</TD>
            <TD className="text-muted">{formatDateTime(log.created_at)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function Pager({ page, data, onPage }: { page: number; data: Page<unknown>; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  if (pages <= 1) return null;
  return (
    <CardFooter className="justify-between">
      <span className="text-xs text-muted">
        Page {page} of {pages} · {data.total} events
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </CardFooter>
  );
}

function OrgAuditCard() {
  const org = useCurrentOrg();
  const [page, setPage] = useState(1);
  const logs = useQuery({
    queryKey: orgKeys.scoped(org.id, "audit", page),
    queryFn: () => orgApi.auditLogs(org.id, page),
    placeholderData: keepPreviousData,
  });
  return (
    <Card>
      <CardHeader title="Organization audit log" description={`Every administrative change in ${org.name}.`} />
      {logs.isLoading ? (
        <LoadingRows />
      ) : logs.error ? (
        <ErrorState message={errorMessage(logs.error)} onRetry={() => void logs.refetch()} />
      ) : (
        logs.data && (
          <>
            <AuditTable data={logs.data} showActor />
            <Pager page={page} data={logs.data} onPage={setPage} />
          </>
        )
      )}
    </Card>
  );
}

function AccountActivityCard() {
  const [page, setPage] = useState(1);
  const logs = useQuery({ queryKey: ["activity", page], queryFn: () => authApi.activity(page), placeholderData: keepPreviousData });
  return (
    <Card>
      <CardHeader title="Your account activity" description="Sign-ins and security changes on your account." />
      {logs.isLoading ? (
        <LoadingRows />
      ) : logs.error ? (
        <ErrorState message={errorMessage(logs.error)} onRetry={() => void logs.refetch()} />
      ) : (
        logs.data && (
          <>
            <AuditTable data={logs.data} showActor={false} />
            <Pager page={page} data={logs.data} onPage={setPage} />
          </>
        )
      )}
    </Card>
  );
}

export function SecurityPage() {
  const org = useCurrentOrg();
  return (
    <>
      <PageHeader title="Security" description="Password, sessions and audit history." />
      <div className="space-y-4">
        <ChangePasswordCard />
        <SessionsCard />
        {org.can("audit.read") && <OrgAuditCard />}
        <AccountActivityCard />
      </div>
    </>
  );
}
