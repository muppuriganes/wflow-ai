import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { type Resolver, useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { applyServerErrors } from "@/hooks/useServerErrors";
import { AuthLayout } from "@/layouts/AuthLayout";
import { authApi } from "@/services/auth";
import { useAuth } from "@/stores/auth";
import { inviteRegisterSchema, type RegisterValues, registerSchema, safeNext } from "./schemas";

export function RegisterPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const joiningInvite = next.startsWith("/invite/");
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(joiningInvite ? inviteRegisterSchema : registerSchema) as Resolver<RegisterValues>,
    defaultValues: { full_name: "", email: params.get("email") ?? "", password: "", organization_name: "" },
  });

  const onSubmit = handleSubmit(async ({ organization_name, ...values }) => {
    setFormError(null);
    try {
      signIn(await authApi.register(joiningInvite ? values : { ...values, organization_name }));
      navigate(next, { replace: true });
    } catch (err) {
      setFormError(applyServerErrors(err, setError, ["full_name", "email", "password", "organization_name"]));
    }
  });

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Set up your business workspace in under a minute."
      footer={
        <>
          Already have an account?{" "}
          <Link to={`/login${params.size ? `?${params}` : ""}`} className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Field label="Full name" error={errors.full_name?.message}>
          <Input autoComplete="name" autoFocus {...register("full_name")} />
        </Field>
        <Field label="Work email" error={errors.email?.message}>
          <Input type="email" autoComplete="email" {...register("email")} />
        </Field>
        <Field label="Password" error={errors.password?.message} hint="At least 10 characters, with a letter and a number.">
          <Input type="password" autoComplete="new-password" {...register("password")} />
        </Field>
        {!joiningInvite && (
          <Field label="Organization name" error={errors.organization_name?.message} hint="Your company or team. You can rename it later.">
            <Input autoComplete="organization" {...register("organization_name")} />
          </Field>
        )}
        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
