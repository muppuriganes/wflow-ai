import {
  Bot,
  Brain,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/utils/cn";

interface Agent {
  id: string;
  name: string;
  purpose: string;
  model: string;
  knowledgeBase: string;
  status: "active" | "standby" | "training";
  recentActivity: string;
  conversationsHandled: number;
}

const SAMPLE_AGENTS: Agent[] = [
  {
    id: "ag-1",
    name: "Customer Support Tier 1",
    purpose: "Handles FAQs, order status inquiries, and store hours.",
    model: "claude-3-5-sonnet",
    knowledgeBase: "Support Docs v2",
    status: "active",
    recentActivity: "Replied to customer 4m ago",
    conversationsHandled: 342,
  },
  {
    id: "ag-2",
    name: "Lead Qualification Agent",
    purpose: "Engages inbound website leads, asks qualifying budget & timeline questions, creates CRM leads.",
    model: "gpt-4o",
    knowledgeBase: "Sales Playbook 2026",
    status: "active",
    recentActivity: "Qualified lead from WhatsApp 18m ago",
    conversationsHandled: 129,
  },
  {
    id: "ag-3",
    name: "Escalation & Triage Specialist",
    purpose: "Analyzes sentiment, routes angry or high-priority customers directly to human agents.",
    model: "claude-3-5-haiku",
    knowledgeBase: "Escalation Policy",
    status: "standby",
    recentActivity: "Standby — monitoring inbox",
    conversationsHandled: 58,
  },
];

export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>(SAMPLE_AGENTS);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "basic" | "instructions" | "model" | "knowledge" | "escalation"
  >("basic");

  // Create Agent Form State
  const [newName, setNewName] = useState("");
  const [newPurpose, setNewPurpose] = useState("");
  const [newModel, setNewModel] = useState("claude-3-5-sonnet");
  const [newInstructions, setNewInstructions] = useState("");
  const [newKnowledge, setNewKnowledge] = useState("Support Docs v2");

  const filtered = agents.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.purpose.toLowerCase().includes(search.toLowerCase()),
  );

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const newAgent: Agent = {
      id: `ag-${Date.now()}`,
      name: newName.trim(),
      purpose: newPurpose.trim() || "Autonomous assistant",
      model: newModel,
      knowledgeBase: newKnowledge,
      status: "active",
      recentActivity: "Created just now",
      conversationsHandled: 0,
    };

    setAgents([newAgent, ...agents]);
    setCreateOpen(false);
    setNewName("");
    setNewPurpose("");
    setNewInstructions("");
    setActiveTab("basic");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/80 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground font-sans">
            AI Agents
          </h1>
          <p className="mt-1 text-sm text-muted">
            Configure autonomous agents to handle support, lead qualification, and customer routing.
          </p>
        </div>

        <Button onClick={() => setCreateOpen(true)} className="shadow-xs">
          <Plus className="size-4" />
          <span>Create AI Agent</span>
        </Button>
      </div>

      {/* Search & Filters */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 size-4 text-subtle" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents by name or purpose..."
            className="pl-9 text-xs"
          />
        </div>

        <div className="flex items-center gap-2 text-xs text-muted">
          <span>{agents.length} configured</span>
        </div>
      </div>

      {/* Agent List */}
      <Card className="border border-border shadow-card overflow-hidden">
        <Table>
          <THead>
            <TR>
              <TH>Agent Name & Purpose</TH>
              <TH className="w-36">Model</TH>
              <TH className="w-44">Knowledge Base</TH>
              <TH className="w-32">Status</TH>
              <TH className="w-48">Recent Activity</TH>
              <TH className="w-24 text-right">Handled</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((agent) => (
              <TR key={agent.id} className="hover:bg-surface-muted/40 transition-colors">
                <TD>
                  <div className="flex items-start gap-2.5">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary mt-0.5">
                      <Bot className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground text-[13px]">{agent.name}</p>
                      <p className="text-xs text-muted line-clamp-1">{agent.purpose}</p>
                    </div>
                  </div>
                </TD>
                <TD>
                  <span className="font-mono text-xs font-medium text-foreground bg-surface-muted px-2 py-0.5 rounded">
                    {agent.model}
                  </span>
                </TD>
                <TD>
                  <div className="flex items-center gap-1.5 text-xs text-muted">
                    <Brain className="size-3.5 text-purple-400 shrink-0" />
                    <span className="truncate">{agent.knowledgeBase}</span>
                  </div>
                </TD>
                <TD>
                  <StatusPill
                    tone={agent.status === "active" ? "success" : "warning"}
                    label={agent.status === "active" ? "Active" : "Standby"}
                  />
                </TD>
                <TD className="text-xs text-muted">
                  <span className="truncate block">{agent.recentActivity}</span>
                </TD>
                <TD className="text-right font-mono text-xs font-semibold text-foreground">
                  {agent.conversationsHandled}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      {/* Multi-Section Agent Creation Modal */}
      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create New AI Agent"
        description="Configure instructions, foundation model, knowledge access, and human escalation rules."
      >
        <form onSubmit={handleCreate} className="space-y-4">
          {/* Section Tabs */}
          <div className="border-b border-border">
            <div className="flex gap-1 overflow-x-auto pb-2 scrollbar-none">
              <button
                type="button"
                onClick={() => setActiveTab("basic")}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap",
                  activeTab === "basic" ? "bg-primary-soft text-primary" : "text-muted hover:text-foreground",
                )}
              >
                1. Basic Info
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("instructions")}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap",
                  activeTab === "instructions" ? "bg-primary-soft text-primary" : "text-muted hover:text-foreground",
                )}
              >
                2. Instructions
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("model")}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap",
                  activeTab === "model" ? "bg-primary-soft text-primary" : "text-muted hover:text-foreground",
                )}
              >
                3. Model
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("knowledge")}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap",
                  activeTab === "knowledge" ? "bg-primary-soft text-primary" : "text-muted hover:text-foreground",
                )}
              >
                4. Knowledge
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("escalation")}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap",
                  activeTab === "escalation" ? "bg-primary-soft text-primary" : "text-muted hover:text-foreground",
                )}
              >
                5. Escalation
              </button>
            </div>
          </div>

          {/* Tab 1: Basic */}
          {activeTab === "basic" && (
            <div className="space-y-3">
              <Field label="Agent Name" required>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Inbound Sales SDR"
                  required
                />
              </Field>
              <Field label="Purpose & Goal">
                <Input
                  value={newPurpose}
                  onChange={(e) => setNewPurpose(e.target.value)}
                  placeholder="e.g. Qualifies leads and schedules meetings"
                />
              </Field>
            </div>
          )}

          {/* Tab 2: Instructions */}
          {activeTab === "instructions" && (
            <div className="space-y-3">
              <Field label="System Prompt & Persona" description="Tone, guidelines, and behavioral guardrails">
                <Textarea
                  rows={5}
                  value={newInstructions}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNewInstructions(e.target.value)}
                  placeholder="You are an empathetic, professional business assistant for WFlow AI. Answer questions accurately based only on provided knowledge..."
                />
              </Field>
            </div>
          )}

          {/* Tab 3: Model */}
          {activeTab === "model" && (
            <div className="space-y-3">
              <Field label="Foundation Model">
                <NativeSelect value={newModel} onChange={(e) => setNewModel(e.target.value)}>
                  <option value="claude-3-5-sonnet">Claude 3.5 Sonnet (Recommended)</option>
                  <option value="gpt-4o">GPT-4o (OpenAI)</option>
                  <option value="gemini-1.5-pro">Gemini 1.5 Pro (Google)</option>
                  <option value="claude-3-5-haiku">Claude 3.5 Haiku (Fast & low cost)</option>
                </NativeSelect>
              </Field>
              <div className="rounded-lg bg-surface-muted p-3 text-xs text-muted flex items-center gap-2">
                <Sparkles className="size-4 text-primary shrink-0" />
                <span>Models run via WFlow AI's managed inference cluster with zero cold starts.</span>
              </div>
            </div>
          )}

          {/* Tab 4: Knowledge */}
          {activeTab === "knowledge" && (
            <div className="space-y-3">
              <Field label="Attached Knowledge Base">
                <NativeSelect value={newKnowledge} onChange={(e) => setNewKnowledge(e.target.value)}>
                  <option value="Support Docs v2">Support Docs v2 (1,248 vectors)</option>
                  <option value="Sales Playbook 2026">Sales Playbook 2026 (480 vectors)</option>
                  <option value="Pricing & SLAs">Pricing & SLAs (112 vectors)</option>
                </NativeSelect>
              </Field>
              <p className="text-xs text-muted">
                Agent will automatically perform vector semantic search on incoming messages.
              </p>
            </div>
          )}

          {/* Tab 5: Escalation */}
          {activeTab === "escalation" && (
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface">
                <div>
                  <p className="font-semibold text-foreground">Human Takeover on Negative Sentiment</p>
                  <p className="text-muted">Unassigns agent and marks conversation high priority if customer is frustrated.</p>
                </div>
                <input type="checkbox" defaultChecked className="rounded border-border text-primary" />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface">
                <div>
                  <p className="font-semibold text-foreground">Escalate on Unknown Questions</p>
                  <p className="text-muted">Passes to live team if answer confidence is below 80%.</p>
                </div>
                <input type="checkbox" defaultChecked className="rounded border-border text-primary" />
              </div>
            </div>
          )}

          {/* Modal Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-border">
            <Button variant="secondary" type="button" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!newName.trim()}>
              Save & Activate Agent
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
