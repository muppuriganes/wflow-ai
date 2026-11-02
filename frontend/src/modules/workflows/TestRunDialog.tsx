import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { errorMessage } from "@/services/api";
import { inboxApi } from "@/services/inbox";
import { workflowsApi } from "@/services/workflows";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { NodeType, RunDetail, Validation, WorkflowDetail } from "@/types/api";

const NEEDS_CONVERSATION = new Set(["trigger.message_received", "trigger.new_conversation"]);
const FINISHED = new Set(["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"]);

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: WorkflowDetail;
  trigger: NodeType | undefined;
  /** "test" runs the draft without side effects; "live" starts the published manual workflow. */
  mode?: "test" | "live";
  onValidation?: (v: Validation) => void;
  onProgress: (run: RunDetail | null) => void;
};

export function TestRunDialog({ open, onOpenChange, workflow, trigger, mode = "test", onValidation, onProgress }: Props) {
  const org = useCurrentOrg();
  const navigate = useNavigate();
  const [conversationId, setConversationId] = useState("");
  const [message, setMessage] = useState("");
  const [webhook, setWebhook] = useState('{\n  "name": "Priya",\n  "phone": "+91 98000 11111"\n}');
  const [runId, setRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const conversations = useQuery({
    queryKey: orgKeys.scoped(org.id, "conversations", "picker"),
    queryFn: () => inboxApi.list(org.id, { view: "all" }),
    enabled: open,
  });

  // Follow the run until it finishes so the canvas can show each step's result.
  const run = useQuery({
    queryKey: orgKeys.scoped(org.id, "run", runId),
    queryFn: () => workflowsApi.run(org.id, runId!),
    enabled: runId !== null,
    refetchInterval: (q) => (q.state.data && FINISHED.has(q.state.data.status) ? false : 700),
  });
  useEffect(() => {
    if (run.data) onProgress(run.data);
  }, [run.data, onProgress]);

  const type = trigger?.type;
  const needsConversation = type ? NEEDS_CONVERSATION.has(type) : false;

  const submit = async () => {
    setProblem(null);
    let hookBody: Record<string, unknown> | null = null;
    if (type === "trigger.webhook") {
      try {
        const parsed: unknown = JSON.parse(webhook || "{}");
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
        hookBody = parsed as Record<string, unknown>;
      } catch {
        setProblem("The sample webhook body must be a JSON object.");
        return;
      }
    }
    setBusy(true);
    try {
      const body = { conversation_id: conversationId || null, sample_message: message || null, webhook: hookBody };
      if (mode === "live") {
        const started = await workflowsApi.execute(org.id, workflow.id, body);
        toast.success("Workflow started");
        onOpenChange(false);
        navigate(`/executions/${started.id}`);
        return;
      } else {
        const res = await workflowsApi.testRun(org.id, workflow.id, body);
        onValidation?.(res.validation);
        if (!res.run) {
          setProblem("Fix the problems shown on the canvas, then test again.");
          return;
        }
        setRunId(res.run.id);
      }
      onProgress(null);
      onOpenChange(false);
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={mode === "live" ? "Run workflow now" : "Test this workflow"}
      description={
        mode === "live"
          ? "Starts the published version for real: messages are sent and records are changed."
          : "Runs your current draft step by step. Nothing is sent or changed: actions only describe what they would do, and delays and waits are skipped."
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={needsConversation && !conversationId}>
            {mode === "live" ? "Start run" : "Run test"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!trigger && <Alert tone="warning">Add a trigger first.</Alert>}
        {type !== "trigger.webhook" && (
          <Field
            label={needsConversation ? "Conversation" : "Conversation (optional)"}
            hint="Contact details and the conversation come from here, so personalised text shows real values."
          >
            <NativeSelect value={conversationId} onChange={(e) => setConversationId(e.target.value)}>
              <option value="">{conversations.isLoading ? "Loading…" : needsConversation ? "Choose a conversation…" : "None"}</option>
              {(conversations.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.contact.display_name || c.contact.phone_number || "Unknown"} · {c.connection_name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        {mode === "test" && type === "trigger.message_received" && (
          <Field label="Sample incoming message" hint="Used as the message text. Leave empty to use the conversation's last message.">
            <Input value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} placeholder="Hi, what is the price?" />
          </Field>
        )}
        {mode === "test" && type === "trigger.webhook" && (
          <Field label="Sample webhook body (JSON)" hint="Available in steps as {{webhook.<field>}}.">
            <textarea
              className="min-h-32 w-full rounded-md border border-border-strong bg-surface px-2.5 py-2 font-mono text-xs focus-visible:border-primary focus-visible:outline-none"
              value={webhook}
              onChange={(e) => setWebhook(e.target.value)}
            />
          </Field>
        )}
        {problem && <Alert tone="danger">{problem}</Alert>}
      </div>
    </Dialog>
  );
}
