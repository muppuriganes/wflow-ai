import { useMutation } from "@tanstack/react-query";
import { MailWarning } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/services/api";
import { authApi } from "@/services/auth";
import { useAuth } from "@/stores/auth";

export function VerifyEmailBanner() {
  const { user } = useAuth();
  const resend = useMutation({
    mutationFn: authApi.resendVerification,
    onSuccess: () => toast.success(`Verification email sent to ${user?.email}`),
    onError: (err) => toast.error(errorMessage(err)),
  });
  if (!user || user.email_verified_at) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/20 bg-warning-soft px-4 py-2 text-xs lg:px-6">
      <MailWarning className="size-4 text-warning" aria-hidden />
      <span className="text-foreground/80">
        Please verify <strong className="font-medium text-foreground">{user.email}</strong>. Check your inbox for the link.
      </span>
      <Button variant="link" size="sm" className="text-xs" loading={resend.isPending} onClick={() => resend.mutate()}>
        Resend email
      </Button>
    </div>
  );
}
