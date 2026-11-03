import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Building2, Inbox, LayoutDashboard, LogOut, type LucideIcon, Menu, ShieldAlert, Users, X } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { platformApi } from "@/services/admin";
import { useAuth } from "@/stores/auth";
import { cn } from "@/utils/cn";

const NAV: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/requests", label: "Requests", icon: Inbox },
  { to: "/admin/organizations", label: "Organizations", icon: Building2 },
  { to: "/admin/users", label: "Users & logins", icon: Users },
];

/** The Super Admin console: a separate area with its own navigation, for running the platform. */
export function AdminLayout() {
  const { user, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pending = useQuery({
    queryKey: ["admin", "requests", "pending"],
    queryFn: () => platformApi.requests("pending"),
    enabled: !!user?.is_superadmin,
    refetchInterval: 60_000,
  });

  if (!user?.is_superadmin) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <EmptyState
          icon={ShieldAlert}
          title="Super Admin access required"
          description="This console is for the team that runs WFlow AI."
          action={
            <Button asChild variant="secondary">
              <Link to="/">Back to workspace</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const close = () => setMobileOpen(false);
  return (
    // Exactly the window's height: the sidebar stays put and only the content area scrolls.
    <div className="flex h-dvh overflow-hidden bg-background">
      {mobileOpen && <div className="fixed inset-0 z-30 bg-foreground/20 lg:hidden" onClick={close} aria-hidden />}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-dvh w-60 shrink-0 flex-col bg-foreground text-white transition-transform lg:static lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Super Admin navigation"
      >
        <div className="flex h-13 items-center justify-between px-4">
          <Link to="/admin" className="inline-flex items-center gap-2" onClick={close}>
            <BrandMark className="size-6" />
            <span className="text-sm font-semibold tracking-tight">WFlow AI</span>
            <span className="rounded-sm bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">Admin</span>
          </Link>
          <button className="rounded-sm p-1 text-white/70 lg:hidden" onClick={close} aria-label="Close navigation">
            <X className="size-4" />
          </button>
        </div>
        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={close}
              className={({ isActive }) =>
                cn(
                  "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-white/70 hover:bg-white/10 hover:text-white",
                  isActive && "bg-white/15 text-white",
                )
              }
            >
              <item.icon className="size-4" aria-hidden />
              <span className="flex-1">{item.label}</span>
              {item.to === "/admin/requests" && !!pending.data?.length && (
                <span className="rounded-full bg-warning px-1.5 text-[11px] font-semibold text-white" aria-label={`${pending.data.length} pending`}>
                  {pending.data.length}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-1 border-t border-white/10 p-3">
          <Link to="/" className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-white/70 hover:bg-white/10 hover:text-white">
            <ArrowLeft className="size-4" aria-hidden /> Back to workspace
          </Link>
          <button
            onClick={() => void signOut()}
            className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] text-white/70 hover:bg-white/10 hover:text-white"
          >
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
          <p className="truncate px-2.5 pt-1 text-[11px] text-white/50">{user.email}</p>
        </div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-13 shrink-0 items-center gap-3 border-b bg-surface px-4 lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <span className="text-sm font-semibold">Super Admin</span>
        </header>
        <main className="relative min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
