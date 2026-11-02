import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, MailPlus, Trash2, UserPlus, Users } from "lucide-react";
import { Fragment, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Alert, EmptyState, ErrorState, LoadingRows } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { applyServerErrors } from "@/hooks/useServerErrors";
import { emailSchema } from "@/modules/auth/schemas";
import { errorMessage } from "@/services/api";
import { orgApi } from "@/services/organizations";
import { useAuth } from "@/stores/auth";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { Member, Role } from "@/types/api";
import { formatDate, formatRelative } from "@/utils/format";

function useRoles(orgId: string, enabled: boolean) {
  return useQuery({ queryKey: orgKeys.scoped(orgId, "roles"), queryFn: () => orgApi.roles(orgId), enabled });
}

const inviteSchema = z.object({ email: emailSchema, role_key: z.string().min(1, "Choose a role") });
type InviteValues = z.infer<typeof inviteSchema>;

function InviteDialog({ open, onOpenChange, roles }: { open: boolean; onOpenChange: (o: boolean) => void; roles: Role[] }) {
  const org = useCurrentOrg();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const assignable = roles.filter((r) => r.rank <= org.role.rank);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<InviteValues>({ resolver: zodResolver(inviteSchema), defaultValues: { email: "", role_key: "viewer" } });

  const onSubmit = handleSubmit(async ({ email, role_key }) => {
    setFormError(null);
    try {
      await orgApi.invite(org.id, email, role_key);
      await queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "invitations") });
      toast.success(`Invitation sent to ${email}`);
      reset();
      onOpenChange(false);
    } catch (err) {
      setFormError(applyServerErrors(err, setError, ["email", "role_key"]));
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Invite a team member"
      description="They'll get an email with a link to join. Invitations expire after 7 days."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="invite-form" loading={isSubmitting}>
            Send invitation
          </Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" autoFocus {...register("email")} />
        </Field>
        <Field label="Role" error={errors.role_key?.message} hint="You can only grant roles up to your own.">
          <NativeSelect {...register("role_key")}>
            {assignable.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name} — {r.description}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </form>
    </Dialog>
  );
}

function MembersTab({ roles }: { roles: Role[] }) {
  const org = useCurrentOrg();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<Member | null>(null);
  const members = useQuery({ queryKey: orgKeys.scoped(org.id, "members"), queryFn: () => orgApi.members(org.id) });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "members") });
  const changeRole = useMutation({
    mutationFn: ({ member, roleKey }: { member: Member; roleKey: string }) => orgApi.updateMember(org.id, member.id, roleKey),
    onSuccess: (m) => {
      toast.success(`${m.full_name} is now ${m.role.name}`);
      void invalidate();
    },
    onError: (err) => {
      toast.error(errorMessage(err));
      void invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (member: Member) => orgApi.removeMember(org.id, member.id),
    onSuccess: (_, member) => {
      toast.success(`${member.full_name} was removed`);
      setRemoving(null);
      void invalidate();
    },
    onError: (err) => {
      toast.error(errorMessage(err));
      setRemoving(null);
    },
  });

  if (members.isLoading) return <LoadingRows />;
  if (members.error) return <ErrorState message={errorMessage(members.error)} onRetry={() => void members.refetch()} />;

  const canUpdate = org.can("members.update");
  const canRemove = org.can("members.remove");
  return (
    <>
      <Table>
        <THead>
          <TR>
            <TH>Member</TH>
            <TH className="w-56">Role</TH>
            <TH className="w-32">Joined</TH>
            <TH className="w-16">
              <span className="sr-only">Actions</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {members.data?.map((m) => {
            const isSelf = m.user_id === user?.id;
            const manageable = !isSelf && m.role.rank <= org.role.rank;
            return (
              <TR key={m.id}>
                <TD>
                  <p className="font-medium">
                    {m.full_name} {isSelf && <span className="font-normal text-muted">(you)</span>}
                  </p>
                  <p className="text-xs text-muted">{m.email}</p>
                </TD>
                <TD>
                  {canUpdate && manageable ? (
                    <NativeSelect
                      aria-label={`Role for ${m.full_name}`}
                      value={m.role.key}
                      disabled={changeRole.isPending}
                      onChange={(e) => changeRole.mutate({ member: m, roleKey: e.target.value })}
                    >
                      {roles
                        .filter((r) => r.rank <= org.role.rank)
                        .map((r) => (
                          <option key={r.key} value={r.key}>
                            {r.name}
                          </option>
                        ))}
                    </NativeSelect>
                  ) : (
                    <Badge tone={m.role.key === "owner" ? "primary" : "neutral"}>{m.role.name}</Badge>
                  )}
                </TD>
                <TD className="text-muted">{formatDate(m.joined_at)}</TD>
                <TD className="text-right">
                  {canRemove && manageable && (
                    <Tooltip content="Remove member">
                      <Button variant="ghost" size="icon" aria-label={`Remove ${m.full_name}`} onClick={() => setRemoving(m)}>
                        <Trash2 />
                      </Button>
                    </Tooltip>
                  )}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.full_name}?`}
        description={`${removing?.email} will lose access to ${org.name} immediately.`}
        confirmLabel="Remove member"
        danger
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </>
  );
}

function InvitationsTab({ onInvite }: { onInvite?: () => void }) {
  const org = useCurrentOrg();
  const queryClient = useQueryClient();
  const invitations = useQuery({ queryKey: orgKeys.scoped(org.id, "invitations"), queryFn: () => orgApi.invitations(org.id) });
  const revoke = useMutation({
    mutationFn: (id: string) => orgApi.revokeInvitation(org.id, id),
    onSuccess: () => {
      toast.success("Invitation revoked");
      void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "invitations") });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (invitations.isLoading) return <LoadingRows />;
  if (invitations.error) return <ErrorState message={errorMessage(invitations.error)} onRetry={() => void invitations.refetch()} />;
  if (!invitations.data?.length) {
    return (
      <EmptyState
        icon={MailPlus}
        title="No pending invitations"
        description="Invited people appear here until they accept."
        action={onInvite && <Button onClick={onInvite}><UserPlus /> Invite member</Button>}
      />
    );
  }
  return (
    <Table>
      <THead>
        <TR>
          <TH>Email</TH>
          <TH className="w-44">Role</TH>
          <TH className="w-40">Expires</TH>
          <TH className="w-24">
            <span className="sr-only">Actions</span>
          </TH>
        </TR>
      </THead>
      <TBody>
        {invitations.data.map((inv) => (
          <TR key={inv.id}>
            <TD className="font-medium">{inv.email}</TD>
            <TD>
              <Badge>{inv.role.name}</Badge>
            </TD>
            <TD className="text-muted">{inv.status === "expired" ? <Badge tone="warning">Expired</Badge> : formatRelative(inv.expires_at)}</TD>
            <TD className="text-right">
              {org.can("members.invite") && (
                <Button variant="ghost" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(inv.id)}>
                  Revoke
                </Button>
              )}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function RolesTab({ roles }: { roles: Role[] }) {
  const permissions = useQuery({ queryKey: ["permissions"], queryFn: orgApi.permissions, staleTime: Infinity });
  if (permissions.isLoading) return <LoadingRows rows={6} />;
  if (permissions.error) return <ErrorState message={errorMessage(permissions.error)} onRetry={() => void permissions.refetch()} />;

  const categories = [...new Set(permissions.data?.map((p) => p.category))];
  return (
    <Table>
      <THead>
        <TR>
          <TH className="min-w-60">Permission</TH>
          {roles.map((r) => (
            <TH key={r.key} className="px-2 text-center normal-case tracking-normal">
              <Tooltip content={r.description}>
                <span className="cursor-help">{r.name}</span>
              </Tooltip>
            </TH>
          ))}
        </TR>
      </THead>
      <TBody>
        {categories.map((category) => (
          <Fragment key={category}>
            <TR className="bg-surface-muted/40">
              <TD colSpan={roles.length + 1} className="py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {category}
              </TD>
            </TR>
            {permissions.data
              ?.filter((p) => p.category === category)
              .map((p) => (
                <TR key={p.code}>
                  <TD className="py-2">
                    {p.description}
                    <span className="ml-2 font-mono text-[11px] text-subtle">{p.code}</span>
                  </TD>
                  {roles.map((r) => (
                    <TD key={r.key} className="px-2 py-2 text-center">
                      {r.permissions.includes(p.code) ? (
                        <Check className="mx-auto size-4 text-success" aria-label="Granted" />
                      ) : (
                        <span className="text-subtle" aria-label="Not granted">
                          –
                        </span>
                      )}
                    </TD>
                  ))}
                </TR>
              ))}
          </Fragment>
        ))}
      </TBody>
    </Table>
  );
}

export function TeamPage() {
  const org = useCurrentOrg();
  const [inviteOpen, setInviteOpen] = useState(false);
  const canInvite = org.can("members.invite");
  const roles = useRoles(org.id, org.can("roles.read"));

  if (!org.can("members.read")) {
    return (
      <>
        <PageHeader title="Team & Roles" />
        <Card>
          <EmptyState icon={Users} title="No access" description="Your role does not include viewing team members." />
        </Card>
      </>
    );
  }
  const openInvite = canInvite ? () => setInviteOpen(true) : undefined;
  return (
    <>
      <PageHeader
        title="Team & Roles"
        description="Manage who can access this organization and what they can do."
        actions={
          canInvite && (
            <Button onClick={() => setInviteOpen(true)} disabled={!roles.data}>
              <UserPlus /> Invite member
            </Button>
          )
        }
      />
      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="invitations">Pending invitations</TabsTrigger>
          {org.can("roles.read") && <TabsTrigger value="roles">Roles & permissions</TabsTrigger>}
        </TabsList>
        <TabsContent value="members">
          <Card>
            <MembersTab roles={roles.data ?? []} />
          </Card>
        </TabsContent>
        <TabsContent value="invitations">
          <Card>
            <InvitationsTab onInvite={openInvite} />
          </Card>
        </TabsContent>
        <TabsContent value="roles">
          <Card>{roles.data ? <RolesTab roles={roles.data} /> : <LoadingRows rows={6} />}</Card>
        </TabsContent>
      </Tabs>
      {roles.data && <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} roles={roles.data} />}
    </>
  );
}
