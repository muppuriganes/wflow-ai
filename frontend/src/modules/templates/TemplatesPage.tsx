import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, LayoutTemplate, Search, Workflow } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingRows } from "@/components/ui/states";
import { errorMessage } from "@/services/api";
import { templatesApi } from "@/services/templates";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { WorkflowTemplate } from "@/types/api";
import { TemplatePreviewModal } from "./TemplatePreviewModal";

const CATEGORY_TABS = [
  { id: "all", label: "All Templates" },
  { id: "support", label: "Support" },
  { id: "sales", label: "Sales & CRM" },
  { id: "approvals", label: "Approvals" },
  { id: "re-engagement", label: "Re-engagement" },
];

export function TemplatesPage() {
  const org = useCurrentOrg();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [activeCategory, setActiveCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null);

  const list = useQuery({
    queryKey: orgKeys.scoped(org.id, "templates"),
    queryFn: () => templatesApi.list(org.id),
  });

  const instantiateMutation = useMutation({
    mutationFn: (templateId: string) => templatesApi.instantiate(org.id, templateId),
    onSuccess: (wf) => {
      void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "workflows") });
      toast.success(`Workflow “${wf.name}” created from template!`);
      setSelectedTemplate(null);
      navigate(`/workflows/${wf.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const filteredTemplates = useMemo(() => {
    if (!list.data) return [];
    return list.data.filter((tmpl) => {
      const matchCategory = activeCategory === "all" || tmpl.category.toLowerCase() === activeCategory.toLowerCase();
      const matchSearch =
        !searchQuery.trim() ||
        tmpl.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        Boolean(tmpl.description?.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchCategory && matchSearch;
    });
  }, [list.data, activeCategory, searchQuery]);

  const canManage = org.can("workflows.manage");

  return (
    <>
      <PageHeader
        title="Workflow Templates"
        description="Jumpstart your automations with pre-built workflow blueprints for common business communication and CRM flows."
      />

      <div className="space-y-4">
        {/* Filters bar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border sm:border-0">
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveCategory(tab.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeCategory === tab.id
                    ? "bg-primary text-white shadow-xs"
                    : "text-muted hover:bg-surface-muted hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted" />
            <Input
              placeholder="Search templates…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>

        {/* Templates list */}
        {list.isLoading ? (
          <LoadingRows rows={3} />
        ) : list.error ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
        ) : !filteredTemplates.length ? (
          <EmptyState
            icon={LayoutTemplate}
            title="No templates match"
            description="Try adjusting your search query or switching categories."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredTemplates.map((template) => {
              const stepCount = template.definition?.nodes?.length ?? 0;
              return (
                <Card
                  key={template.id}
                  className="flex flex-col justify-between p-5 transition-shadow hover:shadow-md border-border-strong/70"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-sm text-foreground">{template.name}</span>
                      <Badge tone="neutral" className="capitalize text-[11px] shrink-0">
                        {template.category}
                      </Badge>
                    </div>

                    <p className="text-xs text-muted leading-relaxed line-clamp-3">{template.description}</p>
                  </div>

                  <div className="mt-5 pt-3 border-t border-border/60 flex items-center justify-between text-xs text-muted">
                    <span className="flex items-center gap-1">
                      <Workflow className="size-3.5 text-muted" />
                      {stepCount} {stepCount === 1 ? "step" : "steps"}
                    </span>

                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setSelectedTemplate(template)}
                      disabled={!canManage}
                      className="gap-1.5 text-xs h-7"
                    >
                      <Eye className="size-3" />
                      Preview & Use
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <TemplatePreviewModal
        template={selectedTemplate}
        open={Boolean(selectedTemplate)}
        onOpenChange={(open) => !open && setSelectedTemplate(null)}
        isCreating={instantiateMutation.isPending}
        onUseTemplate={(tmpl) => {
          instantiateMutation.mutate(tmpl.id);
        }}
      />
    </>
  );
}

export default TemplatesPage;
