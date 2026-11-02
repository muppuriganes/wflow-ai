import { useQuery } from "@tanstack/react-query";
import { FileText, ImageOff } from "lucide-react";
import { inboxApi } from "@/services/inbox";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { Attachment as AttachmentType } from "@/types/api";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Files load from short-lived signed links; the link is fetched only when shown. */
export function Attachment({ attachment }: { attachment: AttachmentType }) {
  const org = useCurrentOrg();
  const url = useQuery({
    queryKey: orgKeys.scoped(org.id, "attachment-url", attachment.id),
    queryFn: () => inboxApi.attachmentUrl(org.id, attachment.id),
    staleTime: 4 * 60_000, // links are valid for 5 minutes
    gcTime: 4 * 60_000,
  });
  const isImage = attachment.content_type.startsWith("image/");

  if (isImage) {
    if (url.isError) {
      return (
        <span className="flex items-center gap-2 text-xs text-muted">
          <ImageOff className="size-4" aria-hidden /> Image unavailable
        </span>
      );
    }
    return url.data ? (
      <a href={url.data.url} target="_blank" rel="noreferrer" className="block">
        <img src={url.data.url} alt={attachment.file_name} className="max-h-56 max-w-full rounded-md border bg-white object-contain" />
      </a>
    ) : (
      <div className="h-32 w-48 animate-pulse rounded-md bg-surface-muted" aria-label="Loading image" />
    );
  }
  return (
    <a
      href={url.data?.url}
      target="_blank"
      rel="noreferrer"
      aria-disabled={!url.data}
      className="flex items-center gap-2 rounded-md border bg-surface px-2.5 py-2 text-xs hover:bg-surface-muted"
    >
      <FileText className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0">
        <span className="block truncate font-medium">{attachment.file_name}</span>
        <span className="text-muted">{formatSize(attachment.size_bytes)}</span>
      </span>
    </a>
  );
}
