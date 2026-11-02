import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, LoadingRows } from "@/components/ui/states";
import { errorMessage } from "@/services/api";
import { workflowsApi } from "@/services/workflows";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { WorkflowDetail } from "@/types/api";
import { formatDateTime } from "@/utils/format";
import { History } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: WorkflowDetail;
  canRestore: boolean;
  onRestored: (wf: WorkflowDetail) => void;
};

export function VersionsDialog({ open, onOpenChange, workflow, canRestore, onRestored }: Props) {
  const org = useCurrentOrg();
  const versions = useQuery({
    queryKey: orgKeys.scoped(org.id, "workflow", workflow.id, "versions", workflow.published_version),
    queryFn: () => workflowsApi.versions(org.id, workflow.id),
    enabled: open,
  });
  const restore = useMutation({
    mutationFn: (versionId: string) => workflowsApi.restoreVersion(org.id, workflow.id, versionId),
    onSuccess: (wf, versionId) => {
      const v = versions.data?.find((x) => x.id === versionId);
      onRestored(wf);
      onOpenChange(false);
      toast.success(`Version ${v?.version ?? ""} loaded into the editor — publish to make it live`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title="Published versions"
      description="Every publish is kept. Restoring copies a version into the editor; the live version changes only when you publish."
    >
      {versions.isLoading ? (
        <LoadingRows rows={3} />
      ) : versions.error ? (
        <ErrorState message={errorMessage(versions.error)} onRetry={() => void versions.refetch()} />
      ) : !versions.data?.length ? (
        <EmptyState icon={History} title="Not published yet" description="Publish the workflow to create its first version." />
      ) : (
        <ul className="divide-y rounded-md border">
          {versions.data.map((v) => (
            <li key={v.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="w-9 text-sm font-semibold">v{v.version}</span>
              <div className="min-w-0 flex-1 text-xs text-muted">
                {formatDateTime(v.created_at)}
                {v.published_by && ` · ${v.published_by}`}
              </div>
              {v.is_current && <Badge tone="success">Live</Badge>}
              {canRestore && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={restore.isPending && restore.variables === v.id}
                  onClick={() => restore.mutate(v.id)}
                >
                  Restore
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
