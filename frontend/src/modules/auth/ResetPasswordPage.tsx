import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { applyServerErrors } from "@/hooks/useServerErrors";
import { AuthLayout } from "@/layouts/AuthLayout";
import { authApi } from "@/services/auth";
import { type ResetValues, resetSchema } from "./schemas";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetValues>({ resolver: zodResolver(resetSchema), defaultValues: { password: "", confirm: "" } });

  const onSubmit = handleSubmit(async ({ password }) => {
    if (!token) return;
    setFormError(null);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setFormError(applyServerErrors(err, setError, ["password"]));
    }
  });

  const footer = (
    <Link to="/login" className="font-medium text-primary hover:underline">
      Back to sign in
    </Link>
  );

  if (!token) {
    return (
      <AuthLayout title="Invalid reset link" footer={footer}>
        <Alert tone="danger">This link is missing its token. Request a new reset email.</Alert>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" subtitle={done ? undefined : "All other sessions will be signed out."} footer={footer}>
      {done ? (
        <Alert tone="success" title="Password updated">
          You can now <Link to="/login" className="font-medium underline">sign in</Link> with your new password.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <Field label="New password" error={errors.password?.message} hint="At least 10 characters, with a letter and a number.">
            <Input type="password" autoComplete="new-password" autoFocus {...register("password")} />
          </Field>
          <Field label="Confirm password" error={errors.confirm?.message}>
            <Input type="password" autoComplete="new-password" {...register("confirm")} />
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
