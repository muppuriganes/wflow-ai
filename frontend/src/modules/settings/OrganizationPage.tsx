import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { applyServerErrors } from "@/hooks/useServerErrors";
import { errorMessage } from "@/services/api";
import { orgApi } from "@/services/organizations";
import { useAuth } from "@/stores/auth";
import { orgKeys, useCurrentOrg, useOrganization } from "@/stores/organization";
import { formatDate, timezones } from "@/utils/format";

const schema = z.object({
  name: z.string().trim().min(2, "Use at least 2 characters").max(200),
  timezone: z.string().min(1),
});
type Values = z.infer<typeof schema>;

export function OrganizationPage() {
  const org = useCurrentOrg();
  const { organizations } = useOrganization();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = org.can("org.update");
  const [confirm, setConfirm] = useState<"delete" | "leave" | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Values>({ resolver: zodResolver(schema), values: { name: org.name, timezone: org.timezone } });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const updated = await orgApi.update(org.id, values);
      await queryClient.invalidateQueries({ queryKey: orgKeys.all });
      reset({ name: updated.name, timezone: updated.timezone });
      toast.success("Organization updated");
    } catch (err) {
      const message = applyServerErrors(err, setError, ["name", "timezone"]);
      if (message) toast.error(message);
    }
  });

  const members = useQuery({
    queryKey: orgKeys.scoped(org.id, "members"),
    queryFn: () => orgApi.members(org.id),
    enabled: org.can("members.read"),
  });
  const myMembership = members.data?.find((m) => m.user_id === user?.id);

  const afterExit = async (message: string) => {
    setConfirm(null);
    toast.success(message);
    await queryClient.invalidateQueries({ queryKey: orgKeys.all });
  };
  const remove = useMutation({
    mutationFn: () => orgApi.remove(org.id),
    onSuccess: () => afterExit(`${org.name} was deleted`),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const leave = useMutation({
    mutationFn: () => orgApi.removeMember(org.id, myMembership!.id),
    onSuccess: () => afterExit(`You left ${org.name}`),
    onError: (err) => {
      setConfirm(null);
      toast.error(errorMessage(err));
    },
  });

  return (
    <>
      <PageHeader title="Organization" description="Profile and lifecycle of this workspace." />
      <div className="space-y-4">
        <Card>
          <CardHeader title="Profile" description={canEdit ? undefined : "You need the Organization Admin role to edit these settings."} />
          <form onSubmit={onSubmit} noValidate>
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" error={errors.name?.message}>
                <Input disabled={!canEdit} {...register("name")} />
              </Field>
              <Field label="Timezone" error={errors.timezone?.message} hint="Used for schedules, business hours and reports.">
                <NativeSelect disabled={!canEdit} {...register("timezone")}>
                  {timezones().map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <dl className="grid grid-cols-2 gap-2 text-xs sm:col-span-2">
                <dt className="text-muted">Workspace ID</dt>
                <dd className="font-mono text-[11px]">{org.slug}</dd>
                <dt className="text-muted">Created</dt>
                <dd>{formatDate(org.created_at)}</dd>
              </dl>
            </CardBody>
            {canEdit && (
              <CardFooter>
                <Button type="submit" disabled={!isDirty} loading={isSubmitting}>
                  Save changes
                </Button>
              </CardFooter>
            )}
          </form>
        </Card>

        <Card className="border-danger/25">
          <CardHeader title="Danger zone" />
          <CardBody className="space-y-4">
            {myMembership && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">Leave organization</p>
                  <p className="text-xs text-muted">You will lose access until someone invites you again.</p>
                </div>
                <Button variant="danger-outline" onClick={() => setConfirm("leave")}>
                  Leave
                </Button>
              </div>
            )}
            {org.can("org.delete") && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <div>
                  <p className="font-medium">Delete organization</p>
                  <p className="text-xs text-muted">Access stops immediately for every member. Data is retained for recovery.</p>
                </div>
                <Button variant="danger" onClick={() => setConfirm("delete")}>
                  Delete organization
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete ${org.name}?`}
        description={
          organizations.length > 1
            ? "Every member loses access immediately. You'll be switched to another organization."
            : "Every member loses access immediately. This is your only organization."
        }
        confirmLabel="Delete organization"
        danger
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
      <ConfirmDialog
        open={confirm === "leave"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Leave ${org.name}?`}
        description="You will lose access to this organization's data."
        confirmLabel="Leave organization"
        danger
        loading={leave.isPending}
        onConfirm={() => leave.mutate()}
      />
    </>
  );
}
