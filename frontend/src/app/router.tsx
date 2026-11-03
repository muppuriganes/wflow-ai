import type { ComponentType, ReactNode } from "react";
import { createBrowserRouter, Navigate, useLocation } from "react-router";
import { Spinner } from "@/components/ui/states";
import { AppLayout } from "@/layouts/AppLayout";
import { AdminLayout } from "@/modules/admin/AdminLayout";
import { AcceptInvitePage } from "@/modules/auth/AcceptInvitePage";
import { ForgotPasswordPage } from "@/modules/auth/ForgotPasswordPage";
import { LoginPage } from "@/modules/auth/LoginPage";
import { RegisterPage } from "@/modules/auth/RegisterPage";
import { ResetPasswordPage } from "@/modules/auth/ResetPasswordPage";
import { VerifyEmailPage } from "@/modules/auth/VerifyEmailPage";
import { ComingSoonPage } from "@/modules/coming-soon/ComingSoonPage";
import { OverviewPage } from "@/modules/dashboard/OverviewPage";
import { LandingPage } from "@/modules/landing/LandingPage";
import { NotFoundPage } from "@/modules/NotFoundPage";
import { RouteErrorPage } from "@/modules/RouteErrorPage";
import { useAuth } from "@/stores/auth";
import { workspaceNav } from "./navigation";

function FullPageSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  );
}



function GuestOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <FullPageSpinner />;
  if (status === "authenticated") {
    const next = new URLSearchParams(location.search).get("next");
    return <Navigate to={next && next.startsWith("/") && !next.startsWith("//") ? next : "/"} replace />;
  }
  return children;
}

/** Route-level code splitting: each screen's code loads the first time it is opened. */
function page<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M) {
  return async () => ({ Component: (await load())[name] as ComponentType });
}

const comingSoonRoutes = workspaceNav
  .filter((item) => item.milestone)
  .map((item) => ({ path: item.to.slice(1), element: <ComingSoonPage item={item} /> }));


function SignedIn({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <FullPageSpinner />;
  if (status === "anonymous") return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return children;
}

function WorkspaceGate() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") return <FullPageSpinner />;

  // Anonymous visitor at root "/" sees the public marketing landing page
  if (status === "anonymous") {
    if (location.pathname === "/") {
      return <LandingPage />;
    }
    // Deep links to internal workspace routes redirect to login
    const next = location.pathname + location.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  // Authenticated users enter the workspace layout
  return <AppLayout />;
}

export const router = createBrowserRouter([
  {
    errorElement: <RouteErrorPage />,
    children: [
  { path: "/login", element: <GuestOnly><LoginPage /></GuestOnly> },
  { path: "/register", element: <GuestOnly><RegisterPage /></GuestOnly> },
  { path: "/forgot-password", element: <GuestOnly><ForgotPasswordPage /></GuestOnly> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
  { path: "/verify-email", element: <VerifyEmailPage /> },
  { path: "/landing", element: <LandingPage /> },
  { path: "/dev/component-showcase", lazy: page(() => import("@/modules/dev/ComponentShowcasePage"), "ComponentShowcasePage") },
  { path: "/invite/:token", element: <AcceptInvitePage /> },
  {
    // The Super Admin console: a separate area with its own layout and navigation.
    path: "/admin",
    element: <SignedIn><AdminLayout /></SignedIn>,
    children: [
      { index: true, lazy: page(() => import("@/modules/admin/AdminDashboardPage"), "AdminDashboardPage") },
      { path: "requests", lazy: page(() => import("@/modules/admin/AdminRequestsPage"), "AdminRequestsPage") },
      { path: "organizations", lazy: page(() => import("@/modules/admin/AdminOrganizationsPage"), "AdminOrganizationsPage") },
      { path: "organizations/:orgId", lazy: page(() => import("@/modules/admin/AdminOrganizationPage"), "AdminOrganizationPage") },
      { path: "users", lazy: page(() => import("@/modules/admin/AdminUsersPage"), "AdminUsersPage") },
      { path: "users/:userId", lazy: page(() => import("@/modules/admin/AdminUsersPage"), "AdminUserPage") },
    ],
  },
  {
    path: "/",
    element: <WorkspaceGate />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: "agents", lazy: page(() => import("@/modules/ai/AgentsPage"), "AgentsPage") },
      { path: "ai-studio", lazy: page(() => import("@/modules/ai/AiStudioPage"), "AiStudioPage") },
      { path: "knowledge", lazy: page(() => import("@/modules/ai/KnowledgeBasePage"), "KnowledgeBasePage") },
      ...comingSoonRoutes,
      { path: "inbox", lazy: page(() => import("@/modules/inbox/InboxPage"), "InboxPage") },
      { path: "inbox/:conversationId", lazy: page(() => import("@/modules/inbox/InboxPage"), "InboxPage") },
      { path: "contacts", lazy: page(() => import("@/modules/crm/ContactsPage"), "ContactsPage") },
      { path: "contacts/:contactId", lazy: page(() => import("@/modules/crm/ContactDetailPage"), "ContactDetailPage") },
      { path: "leads", lazy: page(() => import("@/modules/crm/LeadsPage"), "LeadsPage") },
      { path: "tasks", lazy: page(() => import("@/modules/crm/TasksPage"), "TasksPage") },
      { path: "workflows", lazy: page(() => import("@/modules/workflows/WorkflowsPage"), "WorkflowsPage") },
      { path: "workflows/:workflowId", lazy: page(() => import("@/modules/workflows/BuilderPage"), "BuilderPage") },
      { path: "executions", lazy: page(() => import("@/modules/executions/ExecutionsPage"), "ExecutionsPage") },
      { path: "executions/:runId", lazy: page(() => import("@/modules/executions/RunDetailPage"), "RunDetailPage") },
      { path: "schedules", lazy: page(() => import("@/modules/schedules/SchedulesPage"), "SchedulesPage") },
      { path: "templates", lazy: page(() => import("@/modules/templates/TemplatesPage"), "TemplatesPage") },
      { path: "integrations", lazy: page(() => import("@/modules/integrations/IntegrationsPage"), "IntegrationsPage") },
      { path: "analytics", lazy: page(() => import("@/modules/analytics/AnalyticsPage"), "AnalyticsPage") },
      { path: "channels", lazy: page(() => import("@/modules/channels/ChannelsPage"), "ChannelsPage") },
      { path: "channels/:connectionId", lazy: page(() => import("@/modules/channels/ConnectionDetailPage"), "ConnectionDetailPage") },
      { path: "organization", lazy: page(() => import("@/modules/settings/OrganizationPage"), "OrganizationPage") },
      { path: "team", lazy: page(() => import("@/modules/settings/TeamPage"), "TeamPage") },
      { path: "security", lazy: page(() => import("@/modules/settings/SecurityPage"), "SecurityPage") },
      { path: "billing", lazy: page(() => import("@/modules/billing/BillingPage"), "BillingPage") },
      { path: "settings", lazy: page(() => import("@/modules/settings/SettingsPage"), "SettingsPage") },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
    ],
  },
]);
