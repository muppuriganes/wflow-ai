import {
  CheckCircle2,
  Cpu,
  Gauge,
  Play,
  RotateCcw,
  Sliders,
  Sparkles,
  Terminal,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { MetricCard } from "@/components/ui/metric-card";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export function AiStudioPage() {
  const [selectedModel, setSelectedModel] = useState("claude-3-5-sonnet");
  const [temperature, setTemperature] = useState(0.7);
  const [prompt, setPrompt] = useState(
    "You are WFlow Assistant. Answer customer inquiries professionally in 2 sentences or less.",
  );
  const [testInput, setTestInput] = useState("Hi, what are your store hours and do you have WhatsApp support?");
  const [testOutput, setTestOutput] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  const handleRunPlayground = (e: React.FormEvent) => {
    e.preventDefault();
    if (!testInput.trim()) return;

    setIsRunning(true);
    setTimeout(() => {
      setTestOutput(
        `We are open Monday through Saturday from 9:00 AM to 7:00 PM IST. Yes, our WhatsApp business support is active 24/7 right through this channel!`,
      );
      setIsRunning(false);
    }, 700);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/80 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground font-sans">
            AI Studio
          </h1>
          <p className="mt-1 text-sm text-muted">
            Configure foundation models, manage system prompts, test outputs, and monitor latency metrics.
          </p>
        </div>

        <StatusPill tone="success" label="Inference Engine Active" />
      </div>

      {/* Inference Metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label="Avg Response Latency"
          value="480 ms"
          icon={Gauge}
          trend={{ value: "-12%", positive: true }}
        />
        <MetricCard
          label="Inference Success Rate"
          value="99.94%"
          icon={CheckCircle2}
          trend={{ value: "+0.1%", positive: true }}
        />
        <MetricCard
          label="Total Tokens (30d)"
          value="2.84M"
          icon={Cpu}
          trend={{ value: "+28%", positive: true }}
        />
        <MetricCard
          label="Active Connected Models"
          value="4 Models"
          icon={Sparkles}
        />
      </div>

      {/* Playground & Configuration Two-Column */}
      <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        {/* Left: Model Configuration & Prompt Editor */}
        <Card className="border border-border shadow-card p-5 space-y-4">
          <div className="flex items-center gap-2 text-foreground font-bold text-sm">
            <Sliders className="size-4 text-primary" />
            <span>Model Configuration</span>
          </div>

          <Field label="Model Architecture">
            <NativeSelect value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
              <option value="claude-3-5-sonnet">Claude 3.5 Sonnet (Anthropic)</option>
              <option value="gpt-4o">GPT-4o (OpenAI)</option>
              <option value="gemini-1.5-pro">Gemini 1.5 Pro (Google Cloud)</option>
              <option value="claude-3-5-haiku">Claude 3.5 Haiku (Low Latency)</option>
            </NativeSelect>
          </Field>

          <Field label={`Temperature: ${temperature}`} description="Lower is more deterministic, higher is more creative">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full accent-primary"
            />
          </Field>

          <Field label="System Prompt Preset" description="Base instructions injected into every agent call">
            <Textarea
              rows={6}
              value={prompt}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
              className="font-mono text-xs"
            />
          </Field>

          <div className="flex justify-end">
            <Button size="sm" variant="secondary" onClick={() => setPrompt("You are WFlow Assistant...")}>
              <RotateCcw className="size-3" /> Reset
            </Button>
          </div>
        </Card>

        {/* Right: Testing Playground */}
        <Card className="border border-border shadow-card p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-border/60">
              <div className="flex items-center gap-2 text-foreground font-bold text-sm">
                <Terminal className="size-4 text-primary" />
                <span>Testing Playground</span>
              </div>
              <Badge tone="primary" className="font-mono text-[10px]">
                {selectedModel}
              </Badge>
            </div>

            {/* Conversation Flow Preview */}
            <div className="my-4 space-y-3 min-h-[220px]">
              {/* User Prompt */}
              <div className="flex justify-end">
                <div className="max-w-[80%] rounded-lg bg-surface-muted border border-border px-3.5 py-2 text-xs text-foreground">
                  <p className="font-semibold text-muted text-[10px] mb-0.5">Test Input</p>
                  <p>{testInput}</p>
                </div>
              </div>

              {/* Model Response */}
              {testOutput && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-lg bg-primary-soft border border-primary/20 px-3.5 py-2 text-xs text-foreground shadow-xs">
                    <p className="font-semibold text-primary text-[10px] mb-0.5">Model Output · 420 ms</p>
                    <p className="whitespace-pre-wrap">{testOutput}</p>
                  </div>
                </div>
              )}

              {isRunning && (
                <div className="flex justify-start">
                  <div className="rounded-lg bg-surface-muted px-3.5 py-2 text-xs text-muted animate-pulse">
                    Generating inference response...
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Test Input Form */}
          <form onSubmit={handleRunPlayground} className="flex gap-2 pt-3 border-t border-border">
            <Input
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              placeholder="Type a sample customer question..."
              className="text-xs flex-1"
            />
            <Button type="submit" disabled={isRunning || !testInput.trim()} className="shadow-xs">
              <Play className="size-3.5" />
              <span>Test</span>
            </Button>
          </form>
        </Card>
      </div>

      {/* Model Health Ledger */}
      <Card className="border border-border shadow-card overflow-hidden">
        <div className="p-4 border-b border-border/80 bg-surface">
          <h2 className="text-sm font-bold text-foreground">Foundation Model Connectivity & Health</h2>
        </div>
        <Table>
          <THead>
            <TR>
              <TH>Model</TH>
              <TH>Provider</TH>
              <TH>Status</TH>
              <TH>P95 Latency</TH>
              <TH className="text-right">Token Usage (Today)</TH>
            </TR>
          </THead>
          <TBody>
            <TR className="hover:bg-surface-muted/40">
              <TD className="font-semibold">Claude 3.5 Sonnet</TD>
              <TD className="text-muted text-xs">Anthropic Cloud</TD>
              <TD><StatusPill tone="success" label="Operational" /></TD>
              <TD className="font-mono text-xs">510 ms</TD>
              <TD className="text-right font-mono text-xs">184,200</TD>
            </TR>
            <TR className="hover:bg-surface-muted/40">
              <TD className="font-semibold">GPT-4o</TD>
              <TD className="text-muted text-xs">OpenAI</TD>
              <TD><StatusPill tone="success" label="Operational" /></TD>
              <TD className="font-mono text-xs">640 ms</TD>
              <TD className="text-right font-mono text-xs">92,400</TD>
            </TR>
            <TR className="hover:bg-surface-muted/40">
              <TD className="font-semibold">Gemini 1.5 Pro</TD>
              <TD className="text-muted text-xs">Google Vertex AI</TD>
              <TD><StatusPill tone="success" label="Operational" /></TD>
              <TD className="font-mono text-xs">490 ms</TD>
              <TD className="text-right font-mono text-xs">45,100</TD>
            </TR>
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
