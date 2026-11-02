import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { type Resolver, useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
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
    defaultValues: {
      full_name: "",
      email: params.get("email") ?? "",
      password: "",
      organization_name: "",
      business_type: "",
      phone: "",
      team_size: "2-5",
      country: "",
      website: "",
      use_case: "",
    },
  });

  const onSubmit = handleSubmit(async (form) => {
    const { full_name, email, password, organization_name, business_type, phone, team_size, country, website, use_case } = form;
    setFormError(null);
    try {
      const account = { full_name, email, password };
      signIn(
        await authApi.register(
          joiningInvite
            ? account
            : {
                ...account,
                organization_name,
                organization_request: {
                  business_type,
                  phone,
                  team_size,
                  country: country || undefined,
                  website: website || undefined,
                  use_case: use_case || undefined,
                },
              },
        ),
      );
      navigate(next, { replace: true });
    } catch (err) {
      setFormError(applyServerErrors(err, setError, ["full_name", "email", "password", "organization_name"]));
    }
  });

  return (
    <AuthLayout
      title={joiningInvite ? "Create your account" : "Request your workspace"}
      subtitle={
        joiningInvite
          ? "Create your account to join the team that invited you."
          : "Tell us a little about your business. Our team reviews new workspaces, usually within one business day."
      }
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
          <fieldset className="space-y-4 border-t pt-4">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted">About your business</legend>
            <Field label="Business name" error={errors.organization_name?.message} hint="Your company or team. You can rename it later.">
              <Input autoComplete="organization" {...register("organization_name")} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type of business" error={errors.business_type?.message}>
                <Input placeholder="e.g. Bakery, Clinic, Retail" {...register("business_type")} />
              </Field>
              <Field label="Business phone (WhatsApp)" error={errors.phone?.message}>
                <Input type="tel" autoComplete="tel" placeholder="+91 98000 12345" {...register("phone")} />
              </Field>
              <Field label="Team size" error={errors.team_size?.message}>
                <NativeSelect {...register("team_size")}>
                  {["1", "2-5", "6-20", "21-100", "100+"].map((v) => (
                    <option key={v} value={v}>
                      {v === "1" ? "Just me" : `${v} people`}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Country (optional)" error={errors.country?.message}>
                <Input autoComplete="country-name" {...register("country")} />
              </Field>
            </div>
            <Field label="Website (optional)" error={errors.website?.message}>
              <Input type="url" placeholder="https://" {...register("website")} />
            </Field>
            <Field label="What will you use WFlow for? (optional)" error={errors.use_case?.message}>
              <textarea
                className="min-h-20 w-full rounded-md border border-border-strong bg-surface px-2.5 py-2 text-[13px] focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/15"
                maxLength={1000}
                placeholder="e.g. Reply to order questions and send delivery updates"
                {...register("use_case")}
              />
            </Field>
          </fieldset>
        )}
        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
          {joiningInvite ? "Create account" : "Send request"}
        </Button>
      </form>
    </AuthLayout>
  );
}
