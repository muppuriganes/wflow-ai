import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Alert, Spinner } from "@/components/ui/states";
import { AuthLayout } from "@/layouts/AuthLayout";
import { errorMessage } from "@/services/api";
import { authApi } from "@/services/auth";
import { useAuth } from "@/stores/auth";

type State = { kind: "working" } | { kind: "done" } | { kind: "error"; message: string };

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const auth = useAuth();
  const [state, setState] = useState<State>(token ? { kind: "working" } : { kind: "error", message: "This link is missing its token." });
  const started = useRef(false);

  useEffect(() => {
    // Tokens are single-use; guard against React StrictMode running the effect twice.
    if (!token || started.current) return;
    started.current = true;
    authApi
      .verifyEmail(token)
      .then((user) => {
        if (auth.status === "authenticated" && auth.user.id === user.id) auth.setUser(user);
        setState({ kind: "done" });
      })
      .catch((err: unknown) => setState({ kind: "error", message: errorMessage(err) }));
  }, [token, auth]);

  return (
    <AuthLayout
      title="Email verification"
      footer={
        <Link to={auth.status === "authenticated" ? "/" : "/login"} className="font-medium text-primary hover:underline">
          {auth.status === "authenticated" ? "Go to your workspace" : "Go to sign in"}
        </Link>
      }
    >
      {state.kind === "working" && <Spinner label="Verifying your email" />}
      {state.kind === "done" && (
        <Alert tone="success" title="Email verified">
          Thanks — your email address is confirmed.
        </Alert>
      )}
      {state.kind === "error" && (
        <Alert tone="danger" title="We couldn't verify this link">
          {state.message} You can request a new link from your workspace.
        </Alert>
      )}
    </AuthLayout>
  );
}
