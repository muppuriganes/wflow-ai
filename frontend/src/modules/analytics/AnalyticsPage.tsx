import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Clock,
  Download,
  MessageSquare,
  TrendingUp,
  Workflow,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingRows } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { API_BASE_URL, errorMessage, getAccessToken } from "@/services/api";
import { analyticsApi } from "@/services/analytics";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { AnalyticsData } from "@/types/api";

type DateRangeOption = "7d" | "30d" | "90d";

function formatResponseTime(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const remainingSecs = Math.round(seconds % 60);
  if (mins < 60) return `${mins}m ${remainingSecs}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    amount,
  );
}

export function AnalyticsPage() {
  const org = useCurrentOrg();
  const [rangeOption, setRangeOption] = useState<DateRangeOption>("30d");
  const [isExporting, setIsExporting] = useState(false);

  const query = useQuery({
    queryKey: orgKeys.scoped(org.id, "analytics", rangeOption),
    queryFn: () => analyticsApi.get(org.id, { range: rangeOption }),
    enabled: org.can("analytics.read"),
  });

  const handleExportCsv = async (exportType: "conversations" | "messages" | "crm" | "workflows" = "conversations") => {
    try {
      setIsExporting(true);
      const url = `${API_BASE_URL}${analyticsApi.exportUrl(org.id, exportType, rangeOption)}`;
      const token = getAccessToken();
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to export analytics CSV");
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `analytics_${exportType}_${rangeOption}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
      toast.success("Analytics CSV exported successfully");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsExporting(false);
    }
  };

  const data: AnalyticsData | undefined = query.data;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Comprehensive operational metrics, conversation volume, CRM performance, and workflow execution health."
        actions={
          <div className="flex items-center gap-2">
            <NativeSelect
              value={rangeOption}
              onChange={(e) => setRangeOption(e.target.value as DateRangeOption)}
              className="h-8 text-xs font-medium"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
            </NativeSelect>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleExportCsv("conversations")}
              disabled={isExporting || query.isLoading || !data}
              className="h-8 text-xs gap-1.5"
            >
              <Download className="size-3.5" />
              {isExporting ? "Exporting…" : "Export CSV"}
            </Button>
          </div>
        }
      />

      {query.isLoading ? (
        <LoadingRows rows={5} />
      ) : query.error ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : !data ? (
        <EmptyState
          icon={BarChart3}
          title="No analytics data"
          description="Analytics will appear here once conversations and workflows run."
        />
      ) : (
        <div className="space-y-6">
          {/* Top KPI Summary Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Card className="p-4 border-border-strong/70">
              <div className="flex items-center justify-between text-muted text-xs font-medium">
                <span>Conversations</span>
                <MessageSquare className="size-4 text-primary" />
              </div>
              <div className="mt-2 text-2xl font-bold text-foreground">
                {data.conversations.new + data.conversations.resolved}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted">
                <span>Resolved: {data.conversations.resolved}</span>
                {data.conversations.new + data.conversations.resolved > 0 && (
                  <Badge tone="neutral" className="text-[10px]">
                    {Math.round(
                      (data.conversations.resolved / (data.conversations.new + data.conversations.resolved)) * 100,
                    )}
                    %
                  </Badge>
                )}
              </div>
            </Card>

            <Card className="p-4 border-border-strong/70">
              <div className="flex items-center justify-between text-muted text-xs font-medium">
                <span>Avg Response Time</span>
                <Clock className="size-4 text-warning" />
              </div>
              <div className="mt-2 text-2xl font-bold text-foreground">
                {formatResponseTime(data.conversations.avg_response_time_seconds)}
              </div>
              <div className="mt-1 text-xs text-muted">First agent reply speed</div>
            </Card>

            <Card className="p-4 border-border-strong/70">
              <div className="flex items-center justify-between text-muted text-xs font-medium">
                <span>Messages Volume</span>
                <div className="flex items-center gap-1 text-[11px]">
                  <span className="flex items-center text-success">
                    <ArrowDownLeft className="size-3" />
                    {data.overview.total_messages_in}
                  </span>
                  <span className="flex items-center text-info">
                    <ArrowUpRight className="size-3" />
                    {data.overview.total_messages_out}
                  </span>
                </div>
              </div>
              <div className="mt-2 text-2xl font-bold text-foreground">
                {data.overview.total_messages_in + data.overview.total_messages_out}
              </div>
              <div className="mt-1 text-xs text-muted">Inbound & outbound total</div>
            </Card>

            <Card className="p-4 border-border-strong/70">
              <div className="flex items-center justify-between text-muted text-xs font-medium">
                <span>Pipeline Value</span>
                <TrendingUp className="size-4 text-success" />
              </div>
              <div className="mt-2 text-2xl font-bold text-foreground">
                {formatCurrency(data.overview.total_pipeline_value)}
              </div>
              <div className="mt-1 text-xs text-muted">
                {data.crm.conversion_rate !== null ? `${data.crm.conversion_rate}% conversion` : "Active pipeline"}{" "}
                ({data.crm.new_contacts} new contacts)
              </div>
            </Card>

            <Card className="p-4 border-border-strong/70">
              <div className="flex items-center justify-between text-muted text-xs font-medium">
                <span>Workflow Runs</span>
                <Workflow className="size-4 text-info" />
              </div>
              <div className="mt-2 text-2xl font-bold text-foreground">{data.workflows.total_runs}</div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted">
                <span>Success rate</span>
                <Badge
                  tone={
                    data.workflows.success_rate !== null && data.workflows.success_rate >= 90
                      ? "success"
                      : "neutral"
                  }
                  className="text-[10px]"
                >
                  {data.workflows.success_rate !== null ? `${Math.round(data.workflows.success_rate)}%` : "—"}
                </Badge>
              </div>
            </Card>
          </div>

          {/* Section: Messages Timeline & Task Overview */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Message Activity Timeline"
                description="Daily inbound vs outbound message volume"
                actions={
                  <div className="flex items-center gap-4 text-xs font-medium">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block size-2.5 rounded-sm bg-emerald-500" />
                      <span className="text-muted">Inbound ({data.overview.total_messages_in})</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block size-2.5 rounded-sm bg-blue-500" />
                      <span className="text-muted">Outbound ({data.overview.total_messages_out})</span>
                    </span>
                  </div>
                }
              />
              <CardBody>
                {!data.messages.length ? (
                  <p className="text-xs text-muted py-8 text-center">No messages sent or received in this period.</p>
                ) : (
                  <div className="space-y-4">
                    {/* Visual Bar Chart */}
                    <div className="relative pt-6 pb-2">
                      {(() => {
                        const maxVal = Math.max(...data.messages.map((d) => Math.max(d.inbound, d.outbound)), 5);
                        return (
                          <div className="flex items-end gap-2 h-44 border-b border-border/60 pb-1 overflow-x-auto">
                            {data.messages.map((day) => {
                              const inPct = Math.min(100, Math.round((day.inbound / maxVal) * 100));
                              const outPct = Math.min(100, Math.round((day.outbound / maxVal) * 100));
                              const shortDate = day.date.slice(5);
                              return (
                                <div
                                  key={day.date}
                                  className="group relative flex-1 min-w-[20px] max-w-[40px] flex flex-col items-center justify-end h-full"
                                >
                                  {/* Tooltip */}
                                  <div className="absolute -top-10 z-10 hidden group-hover:flex flex-col items-center bg-popover text-popover-foreground text-[10px] px-2 py-1 rounded shadow-md whitespace-nowrap pointer-events-none border border-border">
                                    <span className="font-semibold">{day.date}</span>
                                    <span>In: {day.inbound} · Out: {day.outbound}</span>
                                  </div>

                                  <div className="flex items-end gap-1 w-full justify-center h-full">
                                    {/* Inbound bar */}
                                    <div
                                      style={{ height: `${Math.max(inPct, 4)}%` }}
                                      className="w-1/2 bg-emerald-500/85 hover:bg-emerald-500 rounded-t transition-all"
                                      title={`Inbound: ${day.inbound}`}
                                    />
                                    {/* Outbound bar */}
                                    <div
                                      style={{ height: `${Math.max(outPct, 4)}%` }}
                                      className="w-1/2 bg-blue-500/85 hover:bg-blue-500 rounded-t transition-all"
                                      title={`Outbound: ${day.outbound}`}
                                    />
                                  </div>

                                  {/* X-axis label */}
                                  <span className="mt-1 text-[9px] text-muted truncate w-full text-center">
                                    {shortDate}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>

                    {/* Summary row */}
                    <div className="flex items-center justify-between text-[11px] text-muted pt-1">
                      <span>Total Active Days: {data.messages.filter((d) => d.inbound > 0 || d.outbound > 0).length}</span>
                      <span>Daily Average: {Math.round((data.overview.total_messages_in + data.overview.total_messages_out) / Math.max(data.messages.length, 1))} msgs/day</span>
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Task Health & Reminders" description="Team follow-up tasks status" />
              <CardBody className="space-y-4">
                <div className="rounded-lg border border-danger/30 bg-danger-soft/20 p-4">
                  <div className="text-xs font-semibold text-danger">Overdue Tasks</div>
                  <div className="mt-1 text-2xl font-bold text-danger">{data.crm.tasks.overdue}</div>
                  <p className="mt-0.5 text-[11px] text-muted">Action items whose due date has passed</p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs font-semibold text-muted">Completed Tasks</div>
                  <div className="mt-1 text-2xl font-bold text-foreground">{data.crm.tasks.completed}</div>
                  <p className="mt-0.5 text-[11px] text-muted">
                    Total tasks completed ({data.crm.tasks.total} total)
                  </p>
                </div>
              </CardBody>
            </Card>
          </div>

          {/* Section: Channels & Agent Breakdown */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Conversations by Channel" description="Distribution across connected numbers" />
              <CardBody>
                {!data.conversations.by_channel.length ? (
                  <p className="text-xs text-muted py-4 text-center">No channel conversation data recorded.</p>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Channel</TH>
                        <TH className="text-right">Conversations</TH>
                        <TH className="text-right">Share</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {data.conversations.by_channel.map((ch) => {
                        const totalChats = data.conversations.new + data.conversations.resolved;
                        const pct = totalChats > 0 ? Math.round((ch.count / totalChats) * 100) : 0;
                        return (
                          <TR key={ch.connection_id}>
                            <TD className="font-medium">{ch.channel_name}</TD>
                            <TD className="text-right font-mono">{ch.count}</TD>
                            <TD className="text-right text-xs text-muted">{pct}%</TD>
                          </TR>
                        );
                      })}
                    </TBody>
                  </Table>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Conversations by Team Member" description="Resolution workload and speed" />
              <CardBody>
                {!data.conversations.by_agent.length ? (
                  <p className="text-xs text-muted py-4 text-center">No assigned conversations in this period.</p>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Agent</TH>
                        <TH className="text-right">Resolved</TH>
                        <TH className="text-right">Avg Speed</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {data.conversations.by_agent.map((ag) => (
                        <TR key={ag.user_id || ag.name}>
                          <TD className="font-medium">{ag.name}</TD>
                          <TD className="text-right font-mono">{ag.resolved_count}</TD>
                          <TD className="text-right text-xs text-muted">
                            {formatResponseTime(ag.avg_response_time_seconds)}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </CardBody>
            </Card>
          </div>

          {/* Section: CRM Pipeline & Top Failing Automation Steps */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="CRM Lead Stages & Value" description="Deals progression across pipeline" />
              <CardBody>
                {!data.crm.leads_by_stage.length ? (
                  <p className="text-xs text-muted py-4 text-center">No active leads or pipeline stages configured.</p>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Stage</TH>
                        <TH className="text-right">Leads</TH>
                        <TH className="text-right">Pipeline Value</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {data.crm.leads_by_stage.map((st) => (
                        <TR key={st.stage}>
                          <TD className="font-medium capitalize">{st.stage}</TD>
                          <TD className="text-right font-mono">{st.count}</TD>
                          <TD className="text-right font-mono">{formatCurrency(st.total_value)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Top Failing Automation Steps"
                description="Workflow steps with highest failure count"
              />
              <CardBody>
                {!data.workflows.top_failing_steps.length ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center text-xs text-muted">
                    <CheckCircle2 className="size-8 text-success mb-2" />
                    <span>No workflow step failures recorded in this period. Great job!</span>
                  </div>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Step Type</TH>
                        <TH className="text-right">Failures</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {data.workflows.top_failing_steps.map((step) => (
                        <TR key={`${step.node_id}-${step.node_type}`}>
                          <TD>
                            <span className="font-mono text-xs">{step.node_type}</span>
                          </TD>
                          <TD className="text-right font-mono font-semibold text-danger">
                            {step.failure_count}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

export default AnalyticsPage;
