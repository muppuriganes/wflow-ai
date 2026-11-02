import { useState } from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Inbox,
  Layers,
  LayoutDashboard,
  Lock,
  MessageCircle,
  MessageSquare,
  Play,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
  Webhook,
  Workflow,
  Zap,
} from "lucide-react";
import { BrandMark } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/stores/auth";

export function LandingPage() {
  const { status } = useAuth();
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [activeStudioTab, setActiveStudioTab] = useState<"workflow" | "inbox" | "crm" | "analytics">("workflow");
  const [expandedFaq, setExpandedFaq] = useState<number | null>(0);
  const [simulatedRuns, setSimulatedRuns] = useState(1482);
  const [isSimulating, setIsSimulating] = useState(false);

  const handleSimulate = () => {
    setIsSimulating(true);
    setTimeout(() => {
      setSimulatedRuns((prev) => prev + 1);
      setIsSimulating(false);
    }, 600);
  };

  const isYearly = billingCycle === "yearly";

  const plans = [
    {
      name: "Free",
      description: "For founders exploring WhatsApp messaging & automations.",
      monthlyPrice: 0,
      yearlyPrice: 0,
      badge: "Forever Free",
      features: [
        "1 Connected Channel (WhatsApp/Simulator)",
        "2 Team Seats",
        "5 Active Visual Workflows",
        "1,000 Monthly Workflow Executions",
        "Shared Team Inbox & SSE Updates",
        "CRM Contacts & Custom Fields",
        "Community Support",
      ],
      cta: "Get Started Free",
      popular: false,
    },
    {
      name: "Starter",
      description: "For small teams scaling up lead capture and client support.",
      monthlyPrice: 29,
      yearlyPrice: 24,
      badge: "Fast Growing",
      features: [
        "2 Connected Channels",
        "5 Team Seats",
        "25 Active Workflows",
        "10,000 Monthly Executions",
        "Visual 7-Stage CRM Lead Board",
        "Timezone-Aware Follow-Up Tasks",
        "Pre-built Starter Templates",
        "Standard Email Support",
      ],
      cta: "Start 14-Day Trial",
      popular: false,
    },
    {
      name: "Growth",
      description: "The complete automation engine for established sales & ops teams.",
      monthlyPrice: 79,
      yearlyPrice: 64,
      badge: "Most Popular",
      features: [
        "5 Connected Channels",
        "15 Team Seats",
        "100 Active Workflows",
        "50,000 Monthly Executions",
        "Temporal Timezone Cron Schedules",
        "Encrypted Integration Vault & Webhooks",
        "SSRF-Safe HTTP Request Actions",
        "Real-Time Analytics & CSV Export",
        "Priority Customer Support",
      ],
      cta: "Start Free Growth Trial",
      popular: true,
    },
    {
      name: "Business",
      description: "For high-volume operations requiring limitless scale and control.",
      monthlyPrice: 199,
      yearlyPrice: 159,
      badge: "Enterprise Grade",
      features: [
        "Unlimited Channels",
        "50 Team Seats",
        "Unlimited Active Workflows",
        "250,000 Monthly Executions",
        "Full Super Admin Console Access",
        "Comprehensive Audit Log Exports",
        "Prometheus Telemetry Scrape Access",
        "Dedicated Customer Success Manager",
        "Custom SLA & High-Volume Quotas",
      ],
      cta: "Contact Enterprise",
      popular: false,
    },
  ];

  const faqs = [
    {
      q: "How does WFlow AI connect to WhatsApp?",
      a: "WFlow AI connects using an isolated gateway session via whatsapp-web.js. You can link any existing WhatsApp account in seconds simply by scanning a live QR code. For local development or zero-risk automated testing, WFlow AI includes a full-fidelity Simulator Channel that lets you send, receive, and inspect messages without needing a physical phone.",
    },
    {
      q: "How does tenant isolation work? Can other companies see our data?",
      a: "No. Tenant isolation is enforced at the database engine level via PostgreSQL Row Level Security (RLS). Every single tenant query is tagged with the organization ID, and runtime database roles (wflow_app) have NOBYPASSRLS. Even if an application bug occurred, the database physically prevents cross-tenant data leakage.",
    },
    {
      q: "What happens if a workflow is waiting for a reply and the server restarts?",
      a: "Workflows run on Temporal, a durable execution engine. Delays, timers, approval gates, and wait-for-reply actions survive process crashes, server deployments, and container restarts without losing state. Workflows resume exactly where they left off.",
    },
    {
      q: "How does the SSRF protection and encrypted credentials vault work?",
      a: "Third-party API keys and Bearer tokens are stored in the database encrypted with authenticated AES-256-GCM. Outgoing HTTP requests and webhook calls undergo synchronous DNS pre-resolution to block private IPv4 ranges (RFC 1918), loopback, cloud metadata endpoints (169.254.169.254), and internal cluster ports.",
    },
    {
      q: "Are credit cards charged during testing or free trial?",
      a: "Never. The billing integration runs on a Stripe Test Billing Provider. You can explore checkout flows, invoice history, customer portal sessions, and quota upgrades in safe test mode without real money moving.",
    },
    {
      q: "Can we self-host WFlow AI or deploy on our own infrastructure?",
      a: "Yes. WFlow AI is completely containerized with Docker Compose, including PostgreSQL 17 with pgvector, Redis, MinIO, Mailpit, Temporal, Nginx ingress with rate-limiting, and Prometheus monitoring configurations.",
    },
  ];

  return (
    <div className="min-h-screen bg-[#fafafc] text-foreground selection:bg-primary/20 selection:text-primary">
      {/* 1. STICKY TOP NAVBAR */}
      <header className="sticky top-0 z-50 w-full border-b border-border/70 bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-90">
              <BrandMark className="size-8 shadow-sm" />
              <div className="flex flex-col">
                <span className="text-[17px] font-bold tracking-tight text-foreground">WFlow AI</span>
                <span className="text-[10px] font-medium text-muted -mt-1">Business Automation</span>
              </div>
            </Link>
            <Badge tone="primary" className="hidden sm:inline-flex border border-primary/20 font-mono text-[11px] px-2 py-0.5">
              v2.4 Production Ready
            </Badge>
          </div>

          <nav className="hidden md:flex items-center gap-7 text-[13px] font-medium text-muted">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#interactive-demo" className="hover:text-foreground transition-colors">Product Studio</a>
            <a href="#workflows" className="hover:text-foreground transition-colors">Workflows</a>
            <a href="#security" className="hover:text-foreground transition-colors">Security & RLS</a>
            <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
            <a href="#faq" className="hover:text-foreground transition-colors">FAQ</a>
          </nav>

          <div className="flex items-center gap-3">
            {status === "authenticated" ? (
              <Link to="/">
                <Button variant="primary" size="sm" className="gap-2 shadow-sm shadow-primary/20">
                  <LayoutDashboard className="size-4" />
                  <span>Open Workspace</span>
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/login" className="text-[13px] font-medium text-muted hover:text-foreground transition-colors px-2 py-1">
                  Sign In
                </Link>
                <Link to="/register">
                  <Button variant="primary" size="sm" className="gap-1.5 shadow-sm shadow-primary/20">
                    <span>Start Free Trial</span>
                    <ArrowRight className="size-3.5" />
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* 2. HERO SECTION */}
      <section className="relative overflow-hidden pt-12 pb-20 sm:pt-20 sm:pb-28">
        {/* Subtle background glow effect */}
        <div className="pointer-events-none absolute -top-40 left-1/2 -z-10 -translate-x-1/2 transform-gpu blur-3xl sm:-top-80" aria-hidden="true">
          <div
            className="aspect-[1155/678] w-[68rem] bg-gradient-to-tr from-primary/20 via-purple-400/15 to-indigo-500/10 opacity-70"
            style={{
              clipPath:
                "polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)",
            }}
          />
        </div>

        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 text-center">
          {/* Announcement pill */}
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary-soft/60 px-3.5 py-1 text-[12px] font-medium text-primary shadow-xs mb-6">
            <Sparkles className="size-3.5 text-primary animate-pulse" />
            <span>The Multi-Tenant Commercial Business Automation Platform</span>
            <span className="text-muted/60">•</span>
            <span className="text-muted font-normal">WhatsApp + CRM + Visual Workflows</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-foreground leading-[1.12]">
            Automate WhatsApp, CRM & Operations with{" "}
            <span className="bg-gradient-to-r from-primary via-purple-600 to-indigo-600 bg-clip-text text-transparent">
              Visual Workflow Intelligence
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-[16px] sm:text-[17px] text-muted leading-relaxed font-normal">
            Connect WhatsApp in 60 seconds. Unify customer chats in a real-time collaborative inbox.
            Track deals on a visual 7-stage CRM pipeline, and orchestrate durable multi-step automations without code.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link to="/register" className="w-full sm:w-auto">
              <Button size="lg" className="w-full sm:w-auto px-7 py-3 text-[14px] font-semibold bg-primary hover:bg-primary-hover text-white shadow-lg shadow-primary/25 gap-2">
                <span>Start 14-Day Free Trial</span>
                <ArrowRight className="size-4" />
              </Button>
            </Link>
            <a href="#interactive-demo" className="w-full sm:w-auto">
              <Button variant="secondary" size="lg" className="w-full sm:w-auto px-6 py-3 text-[14px] font-medium border-border-strong hover:bg-surface-muted gap-2">
                <Play className="size-4 text-primary fill-primary/10" />
                <span>Take the product tour</span>
              </Button>
            </a>
          </div>

          {/* Trust badges */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[12px] font-medium text-muted">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="size-4 text-success" />
              <span>No credit card required</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="size-4 text-success" />
              <span>Instant QR or Zero-Phone Simulator</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="size-4 text-success" />
              <span>PostgreSQL Row-Level Security</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="size-4 text-success" />
              <span>Temporal Durable Execution</span>
            </div>
          </div>
        </div>

        {/* 3. INTERACTIVE PRODUCT STUDIO PREVIEW */}
        <div id="interactive-demo" className="mx-auto mt-14 max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl border border-border-strong/80 bg-surface shadow-2xl overflow-hidden transition-all duration-300">
            {/* Window control bar */}
            <div className="flex flex-wrap items-center justify-between border-b border-border bg-surface-muted/70 px-4 py-3 gap-3">
              <div className="flex items-center gap-2">
                <div className="size-3 rounded-full bg-[#ff5f56] border border-[#e0443e]" />
                <div className="size-3 rounded-full bg-[#ffbd2e] border border-[#dea123]" />
                <div className="size-3 rounded-full bg-[#27c93f] border border-[#1aab29]" />
                <span className="ml-2 text-[11px] font-mono text-muted">wflow-ai.app/workspace/demo</span>
              </div>

              {/* Tabs */}
              <div className="flex items-center rounded-lg bg-surface border border-border p-1 gap-1">
                <button
                  type="button"
                  onClick={() => setActiveStudioTab("workflow")}
                  className={`flex items-center gap-1.5 px-3 py-1 text-[12px] font-medium rounded-md transition-all ${
                    activeStudioTab === "workflow" ? "bg-primary text-white shadow-xs" : "text-muted hover:text-foreground"
                  }`}
                >
                  <Workflow className="size-3.5" />
                  <span>Workflow Studio</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveStudioTab("inbox")}
                  className={`flex items-center gap-1.5 px-3 py-1 text-[12px] font-medium rounded-md transition-all ${
                    activeStudioTab === "inbox" ? "bg-primary text-white shadow-xs" : "text-muted hover:text-foreground"
                  }`}
                >
                  <Inbox className="size-3.5" />
                  <span>Live Team Inbox</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveStudioTab("crm")}
                  className={`flex items-center gap-1.5 px-3 py-1 text-[12px] font-medium rounded-md transition-all ${
                    activeStudioTab === "crm" ? "bg-primary text-white shadow-xs" : "text-muted hover:text-foreground"
                  }`}
                >
                  <Layers className="size-3.5" />
                  <span>CRM Sales Pipeline</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveStudioTab("analytics")}
                  className={`flex items-center gap-1.5 px-3 py-1 text-[12px] font-medium rounded-md transition-all ${
                    activeStudioTab === "analytics" ? "bg-primary text-white shadow-xs" : "text-muted hover:text-foreground"
                  }`}
                >
                  <BarChart3 className="size-3.5" />
                  <span>Analytics</span>
                </button>
              </div>
              <span className="text-[11px] text-muted">Product tour · example data</span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSimulate}
                  disabled={isSimulating}
                  className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary-soft hover:bg-primary-soft/80 text-primary text-[11px] font-semibold px-2.5 py-1 transition-all"
                >
                  <Zap className={`size-3 ${isSimulating ? "animate-spin text-primary" : ""}`} />
                  <span>{isSimulating ? "Simulating Event..." : "Simulate Inbound Event"}</span>
                </button>
              </div>
            </div>

            {/* TAB CONTENTS */}
            <div className="p-6 bg-[#fafafc]">
              {/* TAB 1: WORKFLOW STUDIO */}
              {activeStudioTab === "workflow" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Workflow: WhatsApp Inbound Lead Qualification & Auto-Routing</h3>
                      <p className="text-xs text-muted">Version 3 • Published & Active on Temporal Engine • Run ID: #run_{simulatedRuns}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="flex items-center gap-1 text-success font-medium">
                        <span className="size-2 rounded-full bg-success animate-pulse" />
                        Listening for Inbound Messages
                      </span>
                    </div>
                  </div>

                  {/* Visual Node Diagram */}
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-center pt-2">
                    {/* Node 1 */}
                    <div className="rounded-xl border-2 border-primary/40 bg-surface p-4 shadow-sm relative group hover:border-primary transition-all">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-primary">Trigger</span>
                        <Badge tone="success" className="text-[10px] border border-success/30">Delivered</Badge>
                      </div>
                      <div className="flex items-center gap-2 mb-1">
                        <MessageSquare className="size-4 text-primary" />
                        <span className="text-xs font-semibold">Inbound WhatsApp</span>
                      </div>
                      <p className="text-[11px] text-muted">Keyword: <code className="text-foreground font-mono font-semibold">#quote</code> or <code className="text-foreground font-mono font-semibold">demo</code></p>
                    </div>

                    <div className="hidden md:flex justify-center text-muted">
                      <ArrowRight className="size-5 text-primary/60" />
                    </div>

                    {/* Node 2 */}
                    <div className="rounded-xl border border-border-strong bg-surface p-4 shadow-sm relative hover:border-primary transition-all">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted">CRM Action</span>
                        <Badge tone="info" className="text-[10px] border border-info/30">Synced</Badge>
                      </div>
                      <div className="flex items-center gap-2 mb-1">
                        <Users className="size-4 text-info" />
                        <span className="text-xs font-semibold">Create Contact & Lead</span>
                      </div>
                      <p className="text-[11px] text-muted">Stage: <strong className="text-foreground">Qualified ($4,500)</strong></p>
                    </div>

                    <div className="hidden md:flex justify-center text-muted">
                      <ArrowRight className="size-5 text-primary/60" />
                    </div>

                    {/* Node 3 */}
                    <div className="rounded-xl border border-border-strong bg-surface p-4 shadow-sm relative hover:border-primary transition-all">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-warning">Durable Delay</span>
                        <Badge tone="warning" className="text-[10px] border border-warning/30">Waiting</Badge>
                      </div>
                      <div className="flex items-center gap-2 mb-1">
                        <Clock className="size-4 text-warning" />
                        <span className="text-xs font-semibold">Wait For Reply (24h)</span>
                      </div>
                      <p className="text-[11px] text-muted">Temporal durable timer surviving reboots</p>
                    </div>
                  </div>

                  {/* Execution Log Snippet */}
                  <div className="mt-4 rounded-lg bg-surface border border-border p-3.5 text-xs font-mono text-muted flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="size-2 rounded-full bg-success" />
                      <span>[Temporal Activity] Sent interactive WhatsApp template via WhatsApp-Web.js gateway</span>
                    </div>
                    <span className="text-foreground font-semibold">Latency: 28ms</span>
                  </div>
                </div>
              )}

              {/* TAB 2: LIVE TEAM INBOX */}
              {activeStudioTab === "inbox" && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-72">
                  <div className="border border-border rounded-lg bg-surface p-3 space-y-2 overflow-y-auto">
                    <div className="text-xs font-semibold text-muted uppercase tracking-wider">Conversations (Live)</div>
                    <div className="p-2.5 rounded-md bg-primary-soft/50 border border-primary/20 space-y-1">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span>Acme Logistics (+1 555-0192)</span>
                        <span className="text-[10px] text-muted">Just now</span>
                      </div>
                      <p className="text-[11px] text-foreground line-clamp-1">Can we automate our delivery status dispatch?</p>
                      <div className="flex items-center gap-1">
                        <Badge tone="primary" className="text-[9px] py-0 px-1 border border-primary/20">Assigned: Alex</Badge>
                        <Badge tone="success" className="text-[9px] py-0 px-1 border border-success/20">VIP</Badge>
                      </div>
                    </div>
                    <div className="p-2.5 rounded-md bg-surface hover:bg-surface-muted border border-border space-y-1">
                      <div className="flex items-center justify-between text-xs font-medium">
                        <span>Sarah Chen (+44 7700-9002)</span>
                        <span className="text-[10px] text-muted">14m ago</span>
                      </div>
                      <p className="text-[11px] text-muted line-clamp-1">Thanks! The quote was approved by our team.</p>
                    </div>
                  </div>

                  <div className="md:col-span-2 border border-border rounded-lg bg-surface p-4 flex flex-col justify-between">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-border pb-2 text-xs">
                        <span className="font-semibold text-foreground">Acme Logistics • Connected via WhatsApp Gateway</span>
                        <Badge tone="success" className="text-[10px] border border-success/20">SSE Stream Active</Badge>
                      </div>

                      <div className="space-y-2 text-xs">
                        <div className="max-w-xs rounded-lg bg-surface-muted p-2.5 text-foreground">
                          Can we automate our delivery status dispatch via your visual workflows?
                          <span className="block text-[9px] text-muted text-right mt-1">11:42 AM</span>
                        </div>
                        <div className="ml-auto max-w-xs rounded-lg bg-primary text-white p-2.5">
                          Yes! Our workflow builder supports WhatsApp auto-replies and webhook triggers. Would you like a demo?
                          <span className="block text-[9px] text-white/70 text-right mt-1">11:43 AM • Sent</span>
                        </div>
                        <div className="max-w-md rounded-md bg-warning-soft/60 border border-warning/20 p-2 text-[11px] text-warning flex items-center gap-2">
                          <Lock className="size-3.5" />
                          <span>Internal Note (Team only): Deal size estimated at $12,000/yr. Lead assigned to Enterprise Queue.</span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-border flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Reply as agent or trigger workflow action..."
                        className="w-full text-xs bg-surface-muted border border-border rounded-md px-3 py-2 outline-none focus:border-primary"
                        readOnly
                        value="Here is our technical architecture spec: wflow-ai.app/docs/arch"
                      />
                      <Button size="sm" variant="primary" className="gap-1">
                        <Send className="size-3" />
                        <span>Send</span>
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: CRM SALES PIPELINE */}
              {activeStudioTab === "crm" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-foreground">Fixed 7-Stage Sales Pipeline with Drag & Drop</span>
                    <span className="text-muted">Total Pipeline Value: <strong className="text-foreground">$248,000</strong></span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="rounded-lg border border-border bg-surface p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span>New Leads (4)</span>
                        <span className="text-muted text-[11px]">$18,500</span>
                      </div>
                      <div className="p-2 rounded border border-border bg-surface-muted/60 text-xs space-y-1">
                        <p className="font-semibold text-foreground">Apex Financial</p>
                        <p className="text-[11px] text-muted">$6,000 • Inbound WhatsApp</p>
                      </div>
                    </div>
                    <div className="rounded-lg border border-border bg-surface p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span>Qualified (3)</span>
                        <span className="text-muted text-[11px]">$42,000</span>
                      </div>
                      <div className="p-2 rounded border border-primary/20 bg-primary-soft/30 text-xs space-y-1">
                        <p className="font-semibold text-foreground">CloudScale Ops</p>
                        <p className="text-[11px] text-muted">$15,000 • Score: 92/100</p>
                      </div>
                    </div>
                    <div className="rounded-lg border border-border bg-surface p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span>Proposal Sent (2)</span>
                        <span className="text-muted text-[11px]">$78,000</span>
                      </div>
                      <div className="p-2 rounded border border-border bg-surface-muted/60 text-xs space-y-1">
                        <p className="font-semibold text-foreground">Vertex Health</p>
                        <p className="text-[11px] text-muted">$48,000 • Expected: Nov 15</p>
                      </div>
                    </div>
                    <div className="rounded-lg border border-border bg-surface p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs font-semibold text-success">
                        <span>Won Deals (12)</span>
                        <span className="text-[11px]">$109,500</span>
                      </div>
                      <div className="p-2 rounded border border-success/30 bg-success-soft text-xs space-y-1">
                        <p className="font-semibold text-foreground">FinEdge Global</p>
                        <p className="text-[11px] text-success font-medium">$32,000 • Closed</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: ANALYTICS (example numbers) */}
              {activeStudioTab === "analytics" && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="rounded-xl border border-border bg-surface p-4 text-center space-y-1">
                    <p className="text-xs font-medium text-muted">First Response Time</p>
                    <p className="text-3xl font-extrabold text-foreground">1.4 <span className="text-sm font-normal text-muted">min</span></p>
                    <p className="text-[11px] text-muted">Measured from your real conversations</p>
                  </div>
                  <div className="rounded-xl border border-border bg-surface p-4 text-center space-y-1">
                    <p className="text-xs font-medium text-muted">Workflow Execution Success</p>
                    <p className="text-3xl font-extrabold text-primary">99.98%</p>
                    <p className="text-[11px] text-muted">Completed vs failed runs, per workflow</p>
                  </div>
                  <div className="rounded-xl border border-border bg-surface p-4 text-center space-y-1">
                    <p className="text-xs font-medium text-muted">Total Monthly Executions</p>
                    <p className="text-3xl font-extrabold text-foreground">{simulatedRuns.toLocaleString()}</p>
                    <p className="text-[11px] text-success font-medium">Metered in Postgres</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 4. SIX CORE CAPABILITY PILLARS */}
      <section id="features" className="py-20 border-t border-border bg-surface">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-xs font-bold uppercase tracking-wider text-primary mb-2">Engineered For Reliability</h2>
            <p className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
              Everything Your Organization Needs to Automate at Scale
            </p>
            <p className="mt-3 text-base text-muted">
              Built on battle-tested enterprise architecture: PostgreSQL Row-Level Security, Temporal durable workflows, Redis Streams, and modern React.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {/* Pillar 1 */}
            <div className="rounded-2xl border border-border bg-[#fafafc] p-6 hover:border-primary/40 hover:shadow-md transition-all space-y-3">
              <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <MessageCircle className="size-5" />
              </div>
              <h3 className="text-lg font-bold text-foreground">WhatsApp Multi-Channel Gateway</h3>
              <p className="text-sm text-muted leading-relaxed">
                Connect your real WhatsApp account in seconds via QR pairing, or develop instantly with the built-in zero-phone Simulator channel. Includes auto-reconnect, delivery acks, and strict opt-out governance.
              </p>
              <ul className="text-xs text-muted space-y-1.5 pt-2">
                <li className="flex items-center gap-2"><Check className="size-3.5 text-success" /> Isolated session folders per tenant</li>
                <li className="flex items-center gap-2"><Check className="size-3.5 text-success" /> STOP/START customer opt-out compliance</li>
                <li className="flex items-center gap-2"><Check className="size-3.5 text-success" /> Channel layer ready for Meta's official API (planned)</li>
              </ul>
            </div>

            {/* Pillar 2 */}
            <div className="rounded-2xl border border-border bg-[#fafafc] p-6 hover:border-primary/40 hover:shadow-md transition-all space-y-3">
              <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <Inbox className="size-5" />
              </div>
              <h3 className="text-lg font-bold text-foreground">Real-Time Collaborative Inbox</h3>
              <p className="text-sm text-muted leading-relaxed">
                Centralize multi-agent communication with instant Server-Sent Events updates. Prevent collisions with auto-assignment, add internal team whispers, and upload media up to 16MB via signed S3 links.
              </p>
              <ul className="text-xs text-muted space-y-1.5 pt-2">
                <li className="flex items-center gap-2"><Check className="size-3.5 text-success" /> Zero-lag SSE updates over Redis pub/sub</li>
                <li className="flex items-center gap-2"><Check className="size-3.5 text-success" /> One-click Human Takeover toggle</li>
                <li className="flex items-center gap-2"><Check className="size-3.5 text-success" /> MinIO / S3 signed links with 5-min TTL</li>
              </ul>
            </div>

            {/* Pillar 3 */}
            <div className="rounded-2xl border border-border bg-[#fafafc] p-6 hover:border-primary/40 hover:shadow-md transition-all space-y-3">
              <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <Layers className="size-5" />
              </div>
              <h3 className="text-lg font-bold text-foreground">Visual CRM & Deal Board</h3>
              <p className="text-sm text-muted leading-relaxed">
                Manage your customer relationships with an interactive 7-stage Kanban board. Track custom attributes (text, numbers, dates, lists), customer timelines, and timezone-aware follow-up tasks.
              </p>
              <ul className="text-xs text-muted space-y-1.5 pt-2">
                <li className="flex items-center gap-2"><Check className="size-3.5 text-success" /> Drag-and-drop lead stage progression</li>
                <li className="flex items-center gap-2"><Check className="size-3.5 text-success" /> Contact custom field server-side validation</li>
                <li className="flex items-center gap-2"><Check className="size-3.5 text-success" /> Due-date alerts local to agent's timezone</li>
              </ul>
            </div>

            {/* Pillar 4 */}
            <div id="workflows" className="rounded-2xl border border-border bg-[#fafafc] p-6 hover:border-primary/40 hover:shadow-md transition-all space-y-3">
              <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <Workflow className="size-5" />
              </div>
              <h3 className="text-lg font-bold text-foreground">Durable Temporal Workflow Engine</h3>
              <p className="text-sm text-muted leading-relaxed">
                Build drag-and-drop React Flow automations with 24+ step types. Temporal workflow code stays deterministic while idempotent activities execute I/O. Supports durable waits that survive reboots.
              </p>
              <ul className="text-xs text-muted space-y-1.5 pt-2">
                <li className="flex items-center gap-2"><Check className="size-3.5 text-success" /> Wait-for-reply, approvals & durable delays</li>
                <li className="flex items-center gap-2"><Check className="size-3.5 text-success" /> Immutable versioned JSONB plans</li>
                <li className="flex items-center gap-2"><Check className="size-3.5 text-success" /> Zero user-supplied code execution risk</li>
              </ul>
            </div>

            {/* Pillar 5 */}
            <div id="security" className="rounded-2xl border border-border bg-[#fafafc] p-6 hover:border-primary/40 hover:shadow-md transition-all space-y-3">
              <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <ShieldCheck className="size-5" />
              </div>
              <h3 className="text-lg font-bold text-foreground">PostgreSQL Row-Level Security (RLS)</h3>
              <p className="text-sm text-muted leading-relaxed">
                Bank-grade multi-tenancy where every tenant table enforces RLS policies in the PostgreSQL engine. Non-members and other organizations get HTTP 404 and cannot query or tamper with tenant rows.
              </p>
              <ul className="text-xs text-muted space-y-1.5 pt-2">
                <li className="flex items-center gap-2"><Check className="size-3.5 text-success" /> App role connects with NOBYPASSRLS</li>
                <li className="flex items-center gap-2"><Check className="size-3.5 text-success" /> 6-rank RBAC system with last-owner locks</li>
                <li className="flex items-center gap-2"><Check className="size-3.5 text-success" /> Append-only tamper-proof audit trails</li>
              </ul>
            </div>

            {/* Pillar 6 */}
            <div className="rounded-2xl border border-border bg-[#fafafc] p-6 hover:border-primary/40 hover:shadow-md transition-all space-y-3">
              <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <Webhook className="size-5" />
              </div>
              <h3 className="text-lg font-bold text-foreground">SSRF Guard & Integration Vault</h3>
              <p className="text-sm text-muted leading-relaxed">
                Securely call external APIs with HTTP request workflow nodes. Third-party secrets are encrypted at rest with AES-256-GCM, and DNS pre-resolution blocks private network attacks and cloud metadata probes.
              </p>
              <ul className="text-xs text-muted space-y-1.5 pt-2">
                <li className="flex items-center gap-2"><Check className="size-3.5 text-success" /> Blocks RFC 1918, 127.0.0.1 & 169.254.169.254</li>
                <li className="flex items-center gap-2"><Check className="size-3.5 text-success" /> HMAC-SHA256 signed outgoing webhooks</li>
                <li className="flex items-center gap-2"><Check className="size-3.5 text-success" /> Prometheus metrics exporter (/metrics)</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 5. PRICING SECTION */}
      <section id="pricing" className="py-20 border-t border-border bg-[#fafafc]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <h2 className="text-xs font-bold uppercase tracking-wider text-primary mb-2">Transparent SaaS Tiers</h2>
            <p className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
              Predictable Pricing Built to Scale With Your Growth
            </p>
            <p className="mt-3 text-base text-muted">
              Every plan includes multi-tenant PostgreSQL RLS isolation, WhatsApp simulator access, and real-time inbox collaboration.
            </p>

            {/* Billing Toggle */}
            <div className="mt-8 inline-flex items-center rounded-full border border-border bg-surface p-1 shadow-xs">
              <button
                type="button"
                onClick={() => setBillingCycle("monthly")}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
                  !isYearly ? "bg-primary text-white shadow-xs" : "text-muted hover:text-foreground"
                }`}
              >
                Monthly Billing
              </button>
              <button
                type="button"
                onClick={() => setBillingCycle("yearly")}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  isYearly ? "bg-primary text-white shadow-xs" : "text-muted hover:text-foreground"
                }`}
              >
                <span>Annual Billing</span>
                <Badge tone="success" className="text-[10px] px-1.5 py-0">
                  Save 20%
                </Badge>
              </button>
            </div>
          </div>

          {/* Pricing Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
            {plans.map((plan) => {
              const price = isYearly ? plan.yearlyPrice : plan.monthlyPrice;
              return (
                <div
                  key={plan.name}
                  className={`relative flex flex-col justify-between rounded-2xl p-6 transition-all duration-200 ${
                    plan.popular
                      ? "border-2 border-primary bg-surface shadow-xl shadow-primary/10 scale-[1.02]"
                      : "border border-border bg-surface shadow-sm hover:border-primary/40 hover:shadow-md"
                  }`}
                >
                  {plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="rounded-full bg-primary text-white text-[11px] font-semibold px-3 py-0.5 shadow-sm">
                        Most Popular
                      </span>
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-lg font-bold text-foreground">{plan.name}</h3>
                      <Badge tone="neutral" className="text-[10px] font-mono">
                        {plan.badge}
                      </Badge>
                    </div>

                    <p className="text-xs text-muted min-h-[32px]">{plan.description}</p>

                    <div className="mt-5 mb-6">
                      <div className="flex items-baseline gap-1">
                        <span className="text-4xl font-extrabold tracking-tight text-foreground">${price}</span>
                        <span className="text-xs text-muted">/ month</span>
                      </div>
                      <p className="text-[11px] text-muted mt-0.5">
                        {isYearly ? (plan.yearlyPrice === 0 ? "Free forever" : `Billed $${plan.yearlyPrice * 12}/year`) : "Billed monthly"}
                      </p>
                    </div>

                    <div className="space-y-2.5 border-t border-border pt-5">
                      <p className="text-xs font-semibold text-foreground">Included with plan:</p>
                      <ul className="space-y-2 text-xs text-muted">
                        {plan.features.map((feature) => (
                          <li key={feature} className="flex items-start gap-2">
                            <Check className="size-4 text-success shrink-0 mt-0.5" />
                            <span className="leading-tight">{feature}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="mt-8">
                    <Link to="/register" className="w-full block">
                      <Button
                        variant={plan.popular ? "primary" : "secondary"}
                        className={`w-full text-xs font-semibold py-2.5 ${
                          plan.popular ? "shadow-md shadow-primary/20" : ""
                        }`}
                      >
                        <span>{plan.cta}</span>
                        <ArrowRight className="size-3.5 ml-1" />
                      </Button>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 6. FAQ ACCORDION */}
      <section id="faq" className="py-20 border-t border-border bg-surface">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-xs font-bold uppercase tracking-wider text-primary mb-2">Got Questions?</h2>
            <p className="text-3xl font-extrabold tracking-tight text-foreground">
              Frequently Asked Questions
            </p>
            <p className="mt-2 text-sm text-muted">
              Everything you need to know about the architecture, security, and WhatsApp connectivity.
            </p>
          </div>

          <div className="space-y-3">
            {faqs.map((faq, index) => {
              const isOpen = expandedFaq === index;
              return (
                <div
                  key={faq.q}
                  className="rounded-xl border border-border bg-[#fafafc] overflow-hidden transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedFaq(isOpen ? null : index)}
                    className="w-full flex items-center justify-between p-4 text-left text-sm font-semibold text-foreground hover:text-primary transition-colors"
                  >
                    <span>{faq.q}</span>
                    {isOpen ? (
                      <ChevronUp className="size-4 text-primary shrink-0" />
                    ) : (
                      <ChevronDown className="size-4 text-muted shrink-0" />
                    )}
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 pt-1 text-xs text-muted leading-relaxed border-t border-border/50">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 7. PRE-FOOTER CALL TO ACTION */}
      <section className="py-20 bg-gradient-to-b from-surface to-[#fafafc] border-t border-border">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 text-center">
          <div className="rounded-3xl border border-primary/20 bg-gradient-to-r from-primary-soft via-purple-50 to-indigo-50/70 p-8 sm:p-14 shadow-xl">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
              Ready to Supercharge Your Business Operations?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm sm:text-base text-muted">
              Start building visual WhatsApp automations, managing customer leads, and tracking team performance in under 2 minutes.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link to="/register" className="w-full sm:w-auto">
                <Button size="lg" className="w-full sm:w-auto px-8 py-3 text-sm font-semibold bg-primary hover:bg-primary-hover text-white shadow-lg shadow-primary/25 gap-2">
                  <span>Create Free Account</span>
                  <ArrowRight className="size-4" />
                </Button>
              </Link>
              <Link to="/login" className="w-full sm:w-auto">
                <Button variant="secondary" size="lg" className="w-full sm:w-auto px-6 py-3 text-sm font-medium border-border-strong bg-surface">
                  Sign In to Workspace
                </Button>
              </Link>
            </div>
            <p className="mt-4 text-xs text-muted">
              No credit card required • Instant Simulator testing • Cancel anytime
            </p>
          </div>
        </div>
      </section>

      {/* 8. FOOTER */}
      <footer className="border-t border-border bg-surface py-12 text-xs text-muted">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-10">
            <div className="col-span-2 space-y-3">
              <div className="flex items-center gap-2">
                <BrandMark className="size-6" />
                <span className="text-base font-bold text-foreground">WFlow AI</span>
              </div>
              <p className="text-xs text-muted max-w-sm leading-relaxed">
                The open, multi-tenant commercial business automation platform. Connect WhatsApp, unify team communication in a real-time collaborative inbox, and orchestrate visual workflows with durable Temporal execution.
              </p>
              <div className="flex items-center gap-2 pt-2">
                <span className="size-2 rounded-full bg-success animate-pulse" />
                <span className="text-[11px] font-medium text-foreground">Built for multi-tenant isolation from day one</span>
              </div>
            </div>

            <div className="space-y-2.5">
              <p className="font-semibold text-foreground text-xs uppercase tracking-wider">Product</p>
              <ul className="space-y-2">
                <li><a href="#features" className="hover:text-foreground transition-colors">WhatsApp Gateway</a></li>
                <li><a href="#interactive-demo" className="hover:text-foreground transition-colors">Team Inbox (SSE)</a></li>
                <li><a href="#interactive-demo" className="hover:text-foreground transition-colors">CRM Sales Board</a></li>
                <li><a href="#workflows" className="hover:text-foreground transition-colors">Temporal Workflows</a></li>
                <li><a href="#pricing" className="hover:text-foreground transition-colors">Plans & Quotas</a></li>
              </ul>
            </div>

            <div className="space-y-2.5">
              <p className="font-semibold text-foreground text-xs uppercase tracking-wider">Architecture</p>
              <ul className="space-y-2">
                <li><span className="text-muted">PostgreSQL 17 RLS</span></li>
                <li><span className="text-muted">Temporal Workflows</span></li>
                <li><span className="text-muted">Redis Streams</span></li>
                <li><span className="text-muted">MinIO Signed S3</span></li>
                <li><span className="text-muted">Prometheus Telemetry</span></li>
              </ul>
            </div>

            <div className="space-y-2.5">
              <p className="font-semibold text-foreground text-xs uppercase tracking-wider">Security</p>
              <ul className="space-y-2">
                <li><span className="text-muted">Argon2id Passwords</span></li>
                <li><span className="text-muted">AES-256-GCM Vault</span></li>
                <li><span className="text-muted">SSRF Protection</span></li>
                <li><span className="text-muted">Brute-Force Lockout</span></li>
                <li><span className="text-muted">HMAC-SHA256 Hooks</span></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-border pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p>© {new Date().getFullYear()} WFlow AI. Commercial multi-tenant SaaS. All rights reserved.</p>
            <div className="flex items-center gap-6">
              <Link to="/login" className="hover:text-foreground transition-colors">Sign In</Link>
              <Link to="/register" className="hover:text-foreground transition-colors">Create Account</Link>
              <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
              <a href="#faq" className="hover:text-foreground transition-colors">FAQ</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
