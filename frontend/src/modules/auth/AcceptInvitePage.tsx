import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Alert, Spinner } from "@/components/ui/states";
import { AuthLayout } from "@/layouts/AuthLayout";
import { errorMessage } from "@/services/api";
import { authApi } from "@/services/auth";
import { orgApi } from "@/services/organizations";
import { useAuth } from "@/stores/auth";

const STORAGE_KEY = "wflow.activeOrganization";

export function AcceptInvitePage() {
  const { token = "" } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const preview = useQuery({ queryKey: ["invitation", token], queryFn: () => orgApi.previewInvitation(token), retry: false });

  const accept = useMutation({
    mutationFn: () => orgApi.acceptInvitation(token),
    onSuccess: async (org) => {
      try {
        localStorage.setItem(STORAGE_KEY, org.id);
      } catch {
        // Non-critical: the app falls back to the first organization.
      }
      // Accepting also verifies the email server-side; pull the updated user.
      if (auth.status === "authenticated") auth.setUser(await authApi.me());
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      navigate("/", { replace: true });
    },
  });

  const next = encodeURIComponent(`/invite/${token}`);
  const invite = preview.data;

  return (
    <AuthLayout title="Team invitation">
      {preview.isLoading && <Spinner label="Loading invitation" />}
      {preview.error && <Alert tone="danger">This invitation link is invalid or no longer exists.</Alert>}
      {invite && (
        <div className="space-y-4">
          <p className="text-[13px] text-muted">
            You've been invited to join <strong className="text-foreground">{invite.organization_name}</strong> as{" "}
            <strong className="text-foreground">{invite.role_name}</strong>.
          </p>
          {invite.status !== "pending" ? (
            <Alert tone="warning">This invitation is {invite.status}. Ask the organization admin to send a new one.</Alert>
          ) : auth.status === "loading" ? (
            <Spinner />
          ) : auth.status === "anonymous" ? (
            <div className="space-y-2">
              <p className="text-xs text-muted">
                Sign in or create an account with <strong className="text-foreground">{invite.email}</strong> to accept.
              </p>
              <Button asChild className="w-full" size="lg">
                <Link to={`/register?next=${next}&email=${encodeURIComponent(invite.email)}`}>Create account</Link>
              </Button>
              <Button asChild variant="secondary" className="w-full" size="lg">
                <Link to={`/login?next=${next}&email=${encodeURIComponent(invite.email)}`}>I already have an account</Link>
              </Button>
            </div>
          ) : auth.user.email !== invite.email ? (
            <Alert tone="warning" title="Different account">
              You're signed in as {auth.user.email}, but this invitation is for {invite.email}. Sign out and sign in with the
              invited address.
            </Alert>
          ) : (
            <>
              {accept.error && <Alert tone="danger">{errorMessage(accept.error)}</Alert>}
              <Button className="w-full" size="lg" loading={accept.isPending} onClick={() => accept.mutate()}>
                Join {invite.organization_name}
              </Button>
            </>
          )}
        </div>
      )}
    </AuthLayout>
  );
}
