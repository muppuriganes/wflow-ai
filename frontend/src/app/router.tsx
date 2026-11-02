import type { ComponentType, ReactNode } from "react";
import { createBrowserRouter, Navigate, useLocation } from "react-router";
import { Spinner } from "@/components/ui/states";
import { AppLayout } from "@/layouts/AppLayout";
import { AcceptInvitePage } from "@/modules/auth/AcceptInvitePage";
import { ForgotPasswordPage } from "@/modules/auth/ForgotPasswordPage";
import { LoginPage } from "@/modules/auth/LoginPage";
import { RegisterPage } from "@/modules/auth/RegisterPage";
import { ResetPasswordPage } from "@/modules/auth/ResetPasswordPage";
import { VerifyEmailPage } from "@/modules/auth/VerifyEmailPage";
import { ComingSoonPage } from "@/modules/coming-soon/ComingSoonPage";
import { OverviewPage } from "@/modules/dashboard/OverviewPage";
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

function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <FullPageSpinner />;
  if (status === "anonymous") {
    const next = location.pathname + location.search;
    return <Navigate to={next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return children;
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

export const router = createBrowserRouter([
  {
    errorElement: <RouteErrorPage />,
    children: [
  { path: "/login", element: <GuestOnly><LoginPage /></GuestOnly> },
  { path: "/register", element: <GuestOnly><RegisterPage /></GuestOnly> },
  { path: "/forgot-password", element: <GuestOnly><ForgotPasswordPage /></GuestOnly> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
  { path: "/verify-email", element: <VerifyEmailPage /> },
  { path: "/invite/:token", element: <AcceptInvitePage /> },
  {
    path: "/",
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <OverviewPage /> },
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
      { path: "channels", lazy: page(() => import("@/modules/channels/ChannelsPage"), "ChannelsPage") },
      { path: "channels/:connectionId", lazy: page(() => import("@/modules/channels/ConnectionDetailPage"), "ConnectionDetailPage") },
      { path: "organization", lazy: page(() => import("@/modules/settings/OrganizationPage"), "OrganizationPage") },
      { path: "team", lazy: page(() => import("@/modules/settings/TeamPage"), "TeamPage") },
      { path: "security", lazy: page(() => import("@/modules/settings/SecurityPage"), "SecurityPage") },
      { path: "settings", lazy: page(() => import("@/modules/settings/SettingsPage"), "SettingsPage") },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
    ],
  },
]);
