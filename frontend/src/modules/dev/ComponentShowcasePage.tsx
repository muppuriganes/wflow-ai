import {
  Activity,
  BarChart3,
  Bot,
  CheckCircle,
  LayoutGrid,
  MessageSquare,
  Sparkles,
  Target,
  Wifi,
  Workflow,
  Zap,
} from "lucide-react";
import { useState } from "react";
import {
  ActivityCard,
  ActivityTimelineCard,
  AgentCard,
  AgentHealthCard,
  AgentPerformanceCard,
  AreaChartCard,
  BarChartCard,
  CardEmptyState,
  CardErrorState,
  CardSkeleton,
  type CardAppearance,
  type CardDensity,
  ChannelCard,
  ConnectionHealthCard,
  CustomerCard,
  DocumentCard,
  DonutChartCard,
  FunnelCard,
  KnowledgeBaseCard,
  LeadCard,
  LeadScoreCard,
  MetricCard,
  MetricComparisonCard,
  MetricProgressCard,
  MetricSparklineCard,
  NotificationCard,
  WorkflowCard,
  WorkflowPerformanceCard,
  WorkflowStatusCard,
} from "@/components/cards";
import { Button } from "@/components/ui/button";

export function ComponentShowcasePage() {
  const [density, setDensity] = useState<CardDensity>("comfortable");
  const [appearance, setAppearance] = useState<CardAppearance>("outlined");

  // Sample fixture data for development preview
  const sparklineData = [18, 22, 28, 24, 35, 42, 38, 45, 52];
  const areaChartData = [
    { label: "Mon", value: 34, secondaryValue: 20 },
    { label: "Tue", value: 52, secondaryValue: 35 },
    { label: "Wed", value: 68, secondaryValue: 42 },
    { label: "Thu", value: 60, secondaryValue: 48 },
    { label: "Fri", value: 85, secondaryValue: 60 },
    { label: "Sat", value: 72, secondaryValue: 50 },
    { label: "Sun", value: 94, secondaryValue: 70 },
  ];
  const barChartData = [
    { label: "WhatsApp", value: 1420 },
    { label: "Website", value: 850 },
    { label: "Telegram", value: 430 },
    { label: "Email", value: 310 },
  ];
  const donutSegments = [
    { label: "Active", value: 45, color: "#7c3aed" },
    { label: "Resolved", value: 35, color: "#10b981" },
    { label: "Pending", value: 20, color: "#f59e0b" },
  ];
  const funnelStages = [
    { label: "Website / Ads Traffic", value: 10000, color: "#7c3aed" },
    { label: "WhatsApp Inbound Inquiries", value: 3200, color: "#8b5cf6" },
    { label: "AI Lead Qualified", value: 1450, color: "#a78bfa" },
    { label: "Demo Booked / Proposal", value: 680, color: "#3b82f6" },
    { label: "Closed Won Deal", value: 240, color: "#10b981" },
  ];

  return (
    <div className="min-h-screen bg-slate-50/70 p-6 md:p-10 space-y-12">
      {/* Top Banner */}
      <div className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary-soft/80 via-surface to-surface p-6 shadow-card">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">
                Dev Environment
              </span>
              <span className="text-xs text-muted font-medium">Design System Reference 2026</span>
            </div>
            <h1 className="mt-2 text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">
              WFlow AI – Advanced Visual Card System
            </h1>
            <p className="mt-1 text-sm text-muted max-w-2xl">
              Central playground of high-performance, responsive, typed data visualization cards. All components are dynamic and support actual backend data models.
            </p>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3 bg-surface p-3 rounded-xl border border-border shadow-xs">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold text-muted uppercase">Density</span>
              <div className="inline-flex rounded-lg border border-border bg-surface-muted p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setDensity("comfortable")}
                  className={`rounded-md px-2.5 py-1 ${density === "comfortable" ? "bg-surface font-semibold text-foreground shadow-xs" : "text-muted"}`}
                >
                  Comfortable
                </button>
                <button
                  type="button"
                  onClick={() => setDensity("compact")}
                  className={`rounded-md px-2.5 py-1 ${density === "compact" ? "bg-surface font-semibold text-foreground shadow-xs" : "text-muted"}`}
                >
                  Compact
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold text-muted uppercase">Appearance</span>
              <div className="inline-flex rounded-lg border border-border bg-surface-muted p-0.5 text-xs">
                {(["outlined", "elevated", "tinted"] as CardAppearance[]).map((app) => (
                  <button
                    key={app}
                    type="button"
                    onClick={() => setAppearance(app)}
                    className={`rounded-md px-2.5 py-1 capitalize ${appearance === app ? "bg-surface font-semibold text-foreground shadow-xs" : "text-muted"}`}
                  >
                    {app}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 1. KPI & METRIC CARD FAMILY */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b border-border/80 pb-2">
          <Zap className="size-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">1. KPI & Metric Card Variants</h2>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Active Conversations"
            value="1,284"
            icon={MessageSquare}
            iconTone="primary"
            trend={{ value: 18.4, positive: true, comparisonLabel: "vs previous 30d" }}
            density={density}
            appearance={appearance}
          />

          <MetricSparklineCard
            title="Messages Processed"
            value="48,290"
            unit="msgs"
            sparklineData={sparklineData}
            icon={Activity}
            iconTone="info"
            trend={{ value: 12.1, positive: true, comparisonLabel: "7-day trend" }}
            density={density}
            appearance={appearance}
          />

          <MetricComparisonCard
            title="Monthly Revenue"
            currentValue="$24,500"
            previousValue="$19,800"
            comparisonLabel="MoM Growth"
            trend={{ value: 23.7, positive: true }}
            icon={BarChart3}
            iconTone="success"
            density={density}
            appearance={appearance}
          />

          <MetricProgressCard
            title="Agent Capacity Target"
            current={4}
            target={5}
            unit="channels"
            segmented
            segmentsCount={5}
            description="4 of 5 WhatsApp slots utilized"
            density={density}
            appearance={appearance}
          />
        </div>

        {/* Featured, Split and Circular Variants */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MetricCard
            title="AI Autonomous Resolution"
            value="94.8%"
            description="Resolved without human escalation"
            variant="circular"
            progress={95}
            trend={{ value: 2.1, positive: true, comparisonLabel: "since last week" }}
            icon={Sparkles}
            iconTone="primary"
            density={density}
            appearance={appearance}
          />

          <MetricCard
            title="Lead Conversion Velocity"
            value="3.2 days"
            description="Average first contact to proposal"
            variant="split"
            icon={Target}
            iconTone="warning"
            trend={{ value: 14.5, positive: true, comparisonLabel: "faster than avg" }}
            density={density}
            appearance={appearance}
          />

          <MetricCard
            title="Enterprise Health Score"
            value="99.9%"
            description="All message brokers & webhook webhooks active"
            variant="featured"
            status="success"
            statusLabel="OPTIMAL"
            icon={CheckCircle}
            iconTone="success"
            density={density}
            appearance={appearance}
          />
        </div>
      </section>

      {/* 2. ANALYTICS & VISUALIZATION CARDS */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b border-border/80 pb-2">
          <BarChart3 className="size-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">2. Analytics & Data Visualization Cards</h2>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <AreaChartCard
            title="Conversation Inflow vs Outbound Replies"
            subtitle="Real-time multi-channel volume over past 7 days"
            data={areaChartData}
            color="#7c3aed"
            secondaryColor="#3b82f6"
            summaryStats={[
              { label: "Total Inbound", value: "450", trend: { value: 18, positive: true } },
              { label: "Total Outbound", value: "325", trend: { value: 14, positive: true } },
            ]}
            density={density}
            appearance={appearance}
          />

          <BarChartCard
            title="Inbound Volume by Channel"
            subtitle="Distribution of messages by originating gateway"
            data={barChartData}
            layout="horizontal"
            summaryStats={[
              { label: "Top Channel", value: "WhatsApp" },
              { label: "Total Reach", value: "3,010" },
            ]}
            density={density}
            appearance={appearance}
          />

          <DonutChartCard
            title="Conversation Lifecycle Distribution"
            subtitle="Current breakdown of organization tickets"
            segments={donutSegments}
            centerLabel="Tickets"
            density={density}
            appearance={appearance}
          />

          <FunnelCard
            title="Lead Capture to Closed Won Funnel"
            subtitle="Conversion drop-off across CRM pipeline stages"
            stages={funnelStages}
            density={density}
            appearance={appearance}
          />
        </div>
      </section>

      {/* 3. WORKFLOW & AUTOMATION CARDS */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b border-border/80 pb-2">
          <Workflow className="size-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">3. Workflow & Automation Cards</h2>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <WorkflowCard
            id="wf_lead_capture"
            name="Lead Qualification & Routing"
            description="Extracts budget & assigns high-value leads to sales reps"
            triggerType="WhatsApp Inbound Message"
            status="active"
            version={3}
            totalRuns7d={1240}
            failedRuns7d={2}
            lastRunAt="3 mins ago"
            density={density}
            appearance={appearance}
          />

          <WorkflowPerformanceCard
            workflowName="Order Status Auto-Reply"
            successRate={98.5}
            totalExecutions={842}
            failedCount={12}
            avgDurationMs={320}
            density={density}
            appearance={appearance}
          />

          <div className="space-y-4">
            <WorkflowStatusCard
              name="Abandoned Cart Follow-Up"
              status="active"
              version={2}
              lastRun="15m ago"
              onToggleStatus={() => {}}
              density={density}
              appearance={appearance}
            />
            <WorkflowStatusCard
              name="Weekend Auto-Responder"
              status="paused"
              version={1}
              lastRun="2d ago"
              onToggleStatus={() => {}}
              density={density}
              appearance={appearance}
            />
          </div>
        </div>
      </section>

      {/* 4. AI AGENT & KNOWLEDGE BASE CARDS */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b border-border/80 pb-2">
          <Bot className="size-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">4. AI Agent & Knowledge Base Cards</h2>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <AgentCard
            id="agent_support"
            name="Aura – Support Concierge"
            purpose="Answers FAQs, resolves billing inquiries & troubleshoots"
            model="gemini-2.5-flash"
            knowledgeBase="Help Center Docs v2"
            status="active"
            handledConversations={3890}
            resolutionRate={92}
            density={density}
            appearance={appearance}
          />

          <AgentHealthCard
            modelName="gemini-2.5-flash"
            provider="Google Vertex AI"
            uptimePercent={99.9}
            p50LatencyMs={340}
            p99LatencyMs={780}
            tokensConsumedToday={142000}
            status="healthy"
            density={density}
            appearance={appearance}
          />

          <AgentPerformanceCard
            agentName="Aura Support Concierge"
            totalConversations={3890}
            autonomousResolvedPercent={92}
            humanEscalationPercent={8}
            satisfactionScore={4.8}
            density={density}
            appearance={appearance}
          />
        </div>

        {/* Knowledge Base & Document */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <KnowledgeBaseCard
            name="Product Catalog & Documentation"
            description="Vector database for semantic search and AI grounded answers"
            documentCount={24}
            totalChunks={1420}
            storageMb={38}
            maxStorageMb={500}
            lastIndexedAt="Today at 10:45 AM"
            density={density}
            appearance={appearance}
          />

          <div className="space-y-3">
            <DocumentCard
              filename="pricing_and_plans_2026.pdf"
              fileSizeBytes={342000}
              chunksCount={48}
              status="indexed"
              indexedAt="1h ago"
              density={density}
              appearance={appearance}
            />
            <DocumentCard
              filename="return_policy_and_warranty.docx"
              fileSizeBytes={180000}
              chunksCount={22}
              status="indexed"
              indexedAt="3h ago"
              density={density}
              appearance={appearance}
            />
            <DocumentCard
              filename="technical_api_specifications.json"
              fileSizeBytes={850000}
              chunksCount={112}
              status="processing"
              density={density}
              appearance={appearance}
            />
          </div>
        </div>
      </section>

      {/* 5. CHANNEL & GATEWAY CARDS */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b border-border/80 pb-2">
          <Wifi className="size-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">5. Channel & Connection Cards</h2>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ChannelCard
            id="conn_whatsapp_main"
            displayName="Sales & Inquiries Line"
            channelType="whatsapp_web"
            phoneNumber="919398850830"
            status="CONNECTED"
            statusLabel="Live Device"
            lastConnectedAt="Active now"
            incomingCount={240}
            outgoingCount={195}
            density={density}
            appearance={appearance}
          />

          <ChannelCard
            id="conn_simulator"
            displayName="Dev Lab Simulator"
            channelType="simulator"
            status="QR_PENDING"
            statusLabel="Waiting for Scan"
            incomingCount={45}
            outgoingCount={42}
            density={density}
            appearance={appearance}
          />

          <ConnectionHealthCard
            totalConnections={2}
            activeSessions={1}
            pendingQrCount={1}
            gatewayStatus="ok"
            latencyMs={38}
            density={density}
            appearance={appearance}
          />
        </div>
      </section>

      {/* 6. CRM & CUSTOMER CARDS */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b border-border/80 pb-2">
          <Target className="size-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">6. CRM & Customer Cards</h2>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <CustomerCard
            id="cust_123"
            name="Basha Shaik"
            phone="87016188416155"
            email="basha@example.com"
            company="NexGen Enterprise"
            tags={[
              { id: "1", name: "VIP" },
              { id: "2", name: "WhatsApp Lead" },
            ]}
            openLeadsCount={2}
            lastActive="5 mins ago"
            density={density}
            appearance={appearance}
          />

          <LeadCard
            id="lead_456"
            title="Enterprise Cloud Migration Deal"
            contactName="Basha Shaik"
            valueAmount={18500}
            stage="PROPOSAL"
            stageLabel="Proposal Sent"
            score={85}
            openTasks={3}
            expectedCloseDate="Nov 15"
            ownerName="Ganesh Muppuri"
            density={density}
            appearance={appearance}
          />

          <LeadScoreCard
            leadTitle="Enterprise Cloud Migration Deal"
            score={85}
            tier="High Intent"
            density={density}
            appearance={appearance}
          />
        </div>
      </section>

      {/* 7. ACTIVITY & NOTIFICATION CARDS */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b border-border/80 pb-2">
          <Activity className="size-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">7. Activity Stream & Notifications</h2>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ActivityTimelineCard
            title="Live Operational Activity"
            subtitle="Real-time multi-agent & workflow execution log"
            items={[
              {
                id: "1",
                title: "New WhatsApp message received",
                description: "Customer Basha Shaik: 'Hi, do you offer trial licenses?'",
                timestamp: "Just now",
                icon: MessageSquare,
                iconTone: "primary",
              },
              {
                id: "2",
                title: "Lead auto-created & assigned",
                description: "AI qualified customer inquiry with score 85/100",
                timestamp: "12 mins ago",
                icon: Target,
                iconTone: "success",
              },
              {
                id: "3",
                title: "Workflow 'Lead Qualification' triggered",
                description: "Executed 6 nodes in 340ms with 100% success",
                timestamp: "45 mins ago",
                icon: Workflow,
                iconTone: "info",
              },
            ]}
            density={density}
            appearance={appearance}
          />

          <div className="space-y-3">
            <ActivityCard
              title="Webhook trigger received"
              description="Stripe payment intent succeeded: invoice WF/2026-27/0001"
              timestamp="2 mins ago"
              icon={Zap}
              iconTone="success"
              status="success"
              statusLabel="PROCESSED"
              density={density}
              appearance={appearance}
            />

            <NotificationCard
              title="WhatsApp session connected"
              message="Mobile +919398850830 authenticated via WhatsApp Web connector. Ready to handle incoming customer traffic."
              severity="success"
              timestamp="10:45 AM"
            />
            <NotificationCard
              title="Lead requires attention"
              message="Deal 'Enterprise Cloud Migration' has 3 overdue follow-up tasks."
              severity="warning"
              timestamp="11:15 AM"
            />
            <NotificationCard
              title="Unofficial client notice"
              message="WhatsApp Web connects through an unofficial client. Always use dedicated numbers for testing."
              severity="info"
              timestamp="Yesterday"
            />
          </div>
        </div>
      </section>

      {/* 8. LOADING, EMPTY, AND ERROR STATES */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b border-border/80 pb-2">
          <LayoutGrid className="size-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">8. Loading, Empty & Error States</h2>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <CardSkeleton variant="metric" />
          <div className="rounded-xl border border-border bg-surface p-4">
            <CardEmptyState
              title="No active campaigns"
              description="Create a WhatsApp outreach campaign to start sending automated broadcasts."
              action={
                <Button size="sm" variant="secondary">
                  Create campaign
                </Button>
              }
            />
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <CardErrorState
              title="Failed to sync metrics"
              message="Could not reach the analytics aggregation service. Please try again."
              onRetry={() => {}}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
