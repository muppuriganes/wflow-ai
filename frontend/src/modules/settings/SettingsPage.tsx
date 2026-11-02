import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { applyServerErrors } from "@/hooks/useServerErrors";
import { authApi } from "@/services/auth";
import { useAuth } from "@/stores/auth";

const schema = z.object({ full_name: z.string().trim().min(1, "Enter your name").max(200) });

export function SettingsPage() {
  const { user, setUser } = useAuth();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), values: { full_name: user?.full_name ?? "" } });

  const onSubmit = handleSubmit(async ({ full_name }) => {
    try {
      const updated = await authApi.updateMe(full_name);
      setUser(updated);
      reset({ full_name: updated.full_name });
      toast.success("Profile updated");
    } catch (err) {
      const message = applyServerErrors(err, setError, ["full_name"]);
      if (message) toast.error(message);
    }
  });

  if (!user) return null;
  return (
    <>
      <PageHeader title="Settings" description="Your personal account settings." />
      <Card>
        <CardHeader title="Profile" />
        <form onSubmit={onSubmit} noValidate>
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" error={errors.full_name?.message}>
              <Input autoComplete="name" {...register("full_name")} />
            </Field>
            <Field
              label="Email"
              hint={user.email_verified_at ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Not verified</Badge>}
            >
              <Input value={user.email} readOnly disabled />
            </Field>
          </CardBody>
          <CardFooter>
            <Button type="submit" disabled={!isDirty} loading={isSubmitting}>
              Save changes
            </Button>
          </CardFooter>
        </form>
      </Card>
    </>
  );
}
