import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Tag as TagIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { errorMessage } from "@/services/api";
import { inboxApi } from "@/services/inbox";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { Tag } from "@/types/api";

export function TagList({ tags }: { tags: Tag[] }) {
  if (!tags.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <Badge key={t.id} tone={t.color}>
          {t.name}
        </Badge>
      ))}
    </span>
  );
}

/** Shows a contact's tags and, for people who can manage contacts, lets them toggle or create tags. */
export function TagEditor({ contactId, tags }: { contactId: string; tags: Tag[] }) {
  const org = useCurrentOrg();
  const queryClient = useQueryClient();
  const canManage = org.can("contacts.manage");
  const [newName, setNewName] = useState("");
  const all = useQuery({ queryKey: orgKeys.scoped(org.id, "tags"), queryFn: () => inboxApi.tags(org.id), enabled: canManage });
  const selected = new Set(tags.map((t) => t.id));

  const save = useMutation({
    mutationFn: (ids: string[]) => inboxApi.setContactTags(org.id, contactId, ids),
    onSuccess: () => {
      for (const key of ["inbox", "conversation", "contacts", "contact"]) void queryClient.invalidateQueries({ queryKey: ["org", org.id, key] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const create = useMutation({
    mutationFn: (name: string) => inboxApi.createTag(org.id, name, "primary"),
    onSuccess: (tag) => {
      setNewName("");
      void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "tags") });
      save.mutate([...selected, tag.id]);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="flex flex-wrap items-center gap-1">
      <TagList tags={tags} />
      {canManage && (
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-muted" aria-label="Edit tags">
            <TagIcon className="size-3" aria-hidden /> {tags.length ? "Edit" : "Add tag"}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Tags</DropdownMenuLabel>
            {all.data?.map((t) => (
              <DropdownMenuItem
                key={t.id}
                onSelect={(e) => {
                  e.preventDefault();
                  const next = new Set(selected);
                  if (next.has(t.id)) next.delete(t.id);
                  else next.add(t.id);
                  save.mutate([...next]);
                }}
              >
                <span className="flex-1">{t.name}</span>
                {selected.has(t.id) && <Check className="!text-primary" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <form
              className="flex items-center gap-1 px-1 pb-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (newName.trim()) create.mutate(newName.trim());
              }}
            >
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                maxLength={50}
                placeholder="New tag"
                aria-label="New tag name"
                className="h-7 min-w-0 flex-1 rounded-sm border border-border-strong px-2 text-xs focus-visible:border-primary focus-visible:outline-none"
              />
              <button type="submit" className="rounded-sm p-1 text-primary hover:bg-primary-soft" aria-label="Create tag">
                <Plus className="size-4" />
              </button>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
