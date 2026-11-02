import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { applyServerErrors } from "@/hooks/useServerErrors";
import { orgApi } from "@/services/organizations";
import { orgKeys, useOrganization } from "@/stores/organization";
import { timezones } from "@/utils/format";

const schema = z.object({
  name: z.string().trim().min(2, "Use at least 2 characters").max(200),
  timezone: z.string().min(1),
});
type Values = z.infer<typeof schema>;

const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export function CreateOrganizationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const { switchTo } = useOrganization();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: "", timezone: browserTimezone } });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const org = await orgApi.create(values);
      await queryClient.invalidateQueries({ queryKey: orgKeys.all });
      switchTo(org.id);
      toast.success(`${org.name} created`);
      reset();
      onOpenChange(false);
      navigate("/");
    } catch (err) {
      setFormError(applyServerErrors(err, setError, ["name", "timezone"]));
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New organization"
      description="Each organization has its own team, channels, data and billing."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-org" loading={isSubmitting}>
            Create organization
          </Button>
        </>
      }
    >
      <form id="create-org" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Field label="Name" error={errors.name?.message}>
          <Input autoFocus {...register("name")} />
        </Field>
        <Field label="Timezone" error={errors.timezone?.message} hint="Used for schedules and reports.">
          <NativeSelect {...register("timezone")}>
            {timezones().map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </form>
    </Dialog>
  );
}
