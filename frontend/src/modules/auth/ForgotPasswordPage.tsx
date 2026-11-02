import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { AuthLayout } from "@/layouts/AuthLayout";
import { errorMessage } from "@/services/api";
import { authApi } from "@/services/auth";
import { emailSchema } from "./schemas";

const schema = z.object({ email: emailSchema });

export function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: "" } });

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError(null);
    try {
      await authApi.forgotPassword(email);
      setSentTo(email);
    } catch (err) {
      setFormError(errorMessage(err));
    }
  });

  return (
    <AuthLayout
      title="Reset your password"
      subtitle={sentTo ? undefined : "Enter your email and we'll send you a reset link."}
      footer={
        <Link to="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sentTo ? (
        <Alert tone="success" title="Check your email">
          If an account exists for <strong>{sentTo}</strong>, a reset link is on its way. It expires in 60 minutes.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <Field label="Email" error={errors.email?.message}>
            <Input type="email" autoComplete="email" autoFocus {...register("email")} />
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
