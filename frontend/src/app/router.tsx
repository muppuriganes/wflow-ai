import type { ReactNode } from "react";
import { createBrowserRouter, Navigate, useLocation } from "react-router";
import { Spinner } from "@/components/ui/states";
import { AppLayout } from "@/layouts/AppLayout";
import { AcceptInvitePage } from "@/modules/auth/AcceptInvitePage";
import { ForgotPasswordPage } from "@/modules/auth/ForgotPasswordPage";
import { LoginPage } from "@/modules/auth/LoginPage";
import { RegisterPage } from "@/modules/auth/RegisterPage";
import { ResetPasswordPage } from "@/modules/auth/ResetPasswordPage";
import { VerifyEmailPage } from "@/modules/auth/VerifyEmailPage";
import { ChannelsPage } from "@/modules/channels/ChannelsPage";
import { ConnectionDetailPage } from "@/modules/channels/ConnectionDetailPage";
import { ComingSoonPage } from "@/modules/coming-soon/ComingSoonPage";
import { OverviewPage } from "@/modules/dashboard/OverviewPage";
import { NotFoundPage } from "@/modules/NotFoundPage";
import { RouteErrorPage } from "@/modules/RouteErrorPage";
import { OrganizationPage } from "@/modules/settings/OrganizationPage";
import { SecurityPage } from "@/modules/settings/SecurityPage";
import { SettingsPage } from "@/modules/settings/SettingsPage";
import { TeamPage } from "@/modules/settings/TeamPage";
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
      { path: "channels", element: <ChannelsPage /> },
      { path: "channels/:connectionId", element: <ConnectionDetailPage /> },
      { path: "organization", element: <OrganizationPage /> },
      { path: "team", element: <TeamPage /> },
      { path: "security", element: <SecurityPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
    ],
  },
]);
