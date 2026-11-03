import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Clock,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  X,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useMatch, useNavigate } from "react-router";
import { adminNav, type NavItem, workspaceNav } from "@/app/navigation";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ErrorState, Spinner } from "@/components/ui/states";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { CreateOrganizationDialog } from "@/modules/settings/CreateOrganizationDialog";
import { errorMessage } from "@/services/api";
import { inboxApi } from "@/services/inbox";
import { useAuth } from "@/stores/auth";
import { LiveUpdatesProvider, useLive } from "@/stores/live";
import { orgKeys, OrganizationProvider, useOrganization } from "@/stores/organization";
import { cn } from "@/utils/cn";
import { formatDateTime } from "@/utils/format";
import { VerifyEmailBanner } from "./VerifyEmailBanner";

function NavSection({
  title,
  items,
  collapsed,
  onNavigate,
  unreadCount,
}: {
  title: string;
  items: NavItem[];
  collapsed: boolean;
  onNavigate: () => void;
  unreadCount?: number;
}) {
  const { pathname } = useLocation();

  return (
    <div className="space-y-1">
      {!collapsed && (
        <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-subtle select-none">
          {title}
        </p>
      )}
      <ul className="space-y-0.5">
        {items.map((item) => {
          const isActive = pathname === item.to || item.also?.some((p) => pathname.startsWith(p));
          const hasBadge = item.to === "/inbox" && (unreadCount ?? 0) > 0;

          const content = (
            <NavLink
              to={item.to}
              end={item.to === "/"}
              onClick={onNavigate}
              className={cn(
                "group relative flex items-center rounded-md text-[13px] transition-colors",
                collapsed
                  ? "size-9 justify-center mx-auto text-muted hover:bg-surface-muted hover:text-foreground"
                  : "h-8.5 gap-2.5 px-2.5 text-muted hover:bg-surface-muted hover:text-foreground",
                isActive &&
                  (collapsed
                    ? "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary font-semibold"
                    : "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary font-semibold"),
              )}
            >
              <item.icon
                className={cn(
                  "size-4 shrink-0 transition-transform group-hover:scale-105",
                  isActive ? "text-primary" : "text-muted group-hover:text-foreground",
                )}
                aria-hidden
              />

              {!collapsed && (
                <>
                  <span className="truncate flex-1">{item.label}</span>
                  {hasBadge && (
                    <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white shadow-xs">
                      {unreadCount! > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                  {item.milestone && (
                    <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-subtle">
                      Soon
                    </span>
                  )}
                </>
              )}

              {collapsed && hasBadge && (
                <span className="absolute top-1 right-1 size-2 rounded-full bg-primary ring-2 ring-surface" />
              )}
            </NavLink>
          );

          return (
            <li key={item.to}>
              {collapsed ? (
                <Tooltip side="right" content={item.label}>
                  {content}
                </Tooltip>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function OrgSwitcher({ collapsed, onCreate }: { collapsed: boolean; onCreate: () => void }) {
  const { organizations, current, switchTo } = useOrganization();
  const navigate = useNavigate();

  if (collapsed) {
    return (
      <Tooltip side="right" content={current?.name || "Organization"}>
        <DropdownMenu>
          <DropdownMenuTrigger className="flex size-9 items-center justify-center rounded-md border bg-surface hover:bg-surface-muted mx-auto shadow-xs">
            <span className="text-[12px] font-bold text-primary">
              {current?.name.slice(0, 1).toUpperCase()}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuLabel>Organizations</DropdownMenuLabel>
            {organizations.map((org) => (
              <DropdownMenuItem
                key={org.id}
                onSelect={() => {
                  switchTo(org.id);
                  navigate("/");
                }}
              >
                <Building2 className="size-4" />
                <span className="flex-1 truncate">{org.name}</span>
                {org.id === current?.id && <Check className="!text-primary" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onCreate}>
              <Plus className="size-4" />
              New organization
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Tooltip>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface p-2 text-left hover:border-border-strong hover:bg-surface-muted/50 transition-colors shadow-xs group">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-soft text-[12px] font-bold text-primary group-hover:scale-105 transition-transform">
          {current?.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-foreground leading-tight">
            {current?.name}
          </span>
          <span className="block truncate text-[11px] text-muted leading-tight mt-0.5">
            {current?.support_session ? "Support · read-only" : current?.role.name || "Member"}
          </span>
        </span>
        <ChevronsUpDown className="size-3.5 text-subtle shrink-0" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60 shadow-overlay">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {organizations.map((org) => (
          <DropdownMenuItem
            key={org.id}
            onSelect={() => {
              switchTo(org.id);
              navigate("/");
            }}
          >
            <Building2 className="size-4 text-muted" />
            <span className="flex-1 truncate font-medium">{org.name}</span>
            {org.support_session && <span className="text-[10px] text-info font-medium">support</span>}
            {org.access_block === "pending" && <span className="text-[10px] text-warning font-medium">pending</span>}
            {org.id === current?.id && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCreate}>
          <Plus className="size-4 text-muted" />
          <span>New organization</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LiveIndicator() {
  const live = useLive();
  const { can } = useOrganization();
  if (!can("inbox.read")) return null;

  return (
    <div
      className="hidden items-center gap-2 rounded-full border border-border/80 bg-surface px-2.5 py-1 text-[11px] font-medium text-muted sm:inline-flex shadow-xs"
      title={live ? "WebSocket connection active: real-time updates connected" : "Reconnecting to real-time events..."}
    >
      <span className="relative flex size-2">
        {live && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
        )}
        <span className={cn("relative inline-flex size-2 rounded-full", live ? "bg-success" : "bg-warning")} />
      </span>
      <span className={live ? "text-foreground font-medium" : "text-warning"}>
        {live ? "Live" : "Connecting"}
      </span>
    </div>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  const initials = user.full_name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-white shadow-xs hover:ring-2 hover:ring-primary/20 transition-all"
        aria-label="Account menu"
      >
        {initials}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 shadow-overlay">
        <div className="px-3 py-2">
          <p className="truncate text-[13px] font-semibold text-foreground">{user.full_name}</p>
          <p className="truncate text-xs text-muted">{user.email}</p>
        </div>
        <DropdownMenuSeparator />
        {user.is_superadmin && (
          <DropdownMenuItem onSelect={() => navigate("/admin")}>
            <ShieldAlert className="size-4 text-primary" />
            <span className="font-medium text-primary">Super Admin console</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => navigate("/settings")}>
          <Settings className="size-4 text-muted" />
          <span>Account settings</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await signOut();
            navigate("/login");
          }}
          className="text-danger focus:text-danger focus:bg-danger-soft"
        >
          <LogOut className="size-4" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Shell() {
  const { user } = useAuth();
  const { current, isLoading, error, refetch, organizations } = useOrganization();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  // Persistent sidebar collapse state
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("wflow:sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("wflow:sidebar-collapsed", String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const inInbox = useMatch("/inbox/*") !== null;
  const inBuilder = useMatch("/workflows/:workflowId") !== null;
  const fullBleed = inInbox || inBuilder;
  const onBilling = useMatch("/billing") !== null;

  // Unread count query
  const org = current;
  const canReadInbox = org ? org.permissions.includes("inbox.read") : false;
  const countsQuery = useQuery({
    queryKey: orgKeys.scoped(org?.id ?? "", "inbox-counts"),
    queryFn: () => inboxApi.counts(org!.id),
    enabled: !!org && canReadInbox,
    refetchInterval: 15_000,
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Loading workspace" />
      </div>
    );
  }
  if (error) {
    return <ErrorState message={errorMessage(error)} onRetry={refetch} />;
  }
  if (!current) {
    return (
      <NoOrganization
        onCreate={() => setCreateOpen(true)}
        createOpen={createOpen}
        setCreateOpen={setCreateOpen}
        hadOrgs={organizations.length > 0}
      />
    );
  }
  if (current.access_block === "pending" || current.access_block === "rejected") {
    return <WorkspaceClosed />;
  }
  const mustPay = current.access_block === "billing_required" && !onBilling;

  const closeMobile = () => setMobileOpen(false);

  return (
    <TooltipProvider>
      <div className="flex h-full bg-background overflow-hidden">
        {/* Mobile Backdrop */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-30 bg-foreground/30 backdrop-blur-xs lg:hidden transition-opacity"
            onClick={closeMobile}
            aria-hidden
          />
        )}

        {/* Sidebar */}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border bg-surface transition-all duration-200 lg:static lg:translate-x-0 shadow-sm",
            collapsed ? "w-16" : "w-60",
            mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
          )}
          aria-label="Main navigation"
        >
          {/* Logo & Header */}
          <div className="flex h-14 items-center justify-between px-3.5 border-b border-border/60">
            <Link
              to="/"
              className={cn("inline-flex items-center gap-2.5", collapsed && "mx-auto")}
              onClick={closeMobile}
            >
              <BrandMark className="size-6 shrink-0" />
              {!collapsed && (
                <span className="text-sm font-bold tracking-tight text-foreground font-sans">
                  WFlow AI
                </span>
              )}
            </Link>

            {!collapsed && (
              <button
                type="button"
                onClick={toggleCollapsed}
                className="hidden lg:flex size-6 items-center justify-center rounded text-muted hover:bg-surface-muted hover:text-foreground transition-colors"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <ChevronLeft className="size-4" />
              </button>
            )}

            <button
              className="rounded p-1 text-muted hover:bg-surface-muted lg:hidden"
              onClick={closeMobile}
              aria-label="Close navigation"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Org Switcher */}
          <div className="p-2.5">
            <OrgSwitcher collapsed={collapsed} onCreate={() => setCreateOpen(true)} />
          </div>

          {/* Nav Items */}
          <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-4 scrollbar-thin">
            <NavSection
              title="Workspace"
              items={workspaceNav}
              collapsed={collapsed}
              onNavigate={closeMobile}
              unreadCount={countsQuery.data?.open}
            />
            <NavSection
              title="Administration"
              items={adminNav}
              collapsed={collapsed}
              onNavigate={closeMobile}
            />
          </nav>

          {/* Pinned Bottom (Super Admin & Collapse expander) */}
          <div className="border-t border-border/60 p-2 space-y-1">
            {collapsed && (
              <button
                type="button"
                onClick={toggleCollapsed}
                className="flex size-9 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-foreground mx-auto transition-colors"
                title="Expand sidebar"
                aria-label="Expand sidebar"
              >
                <ChevronRight className="size-4" />
              </button>
            )}

            {user?.is_superadmin &&
              (collapsed ? (
                <Tooltip side="right" content="Super Admin console">
                  <Link
                    to="/admin"
                    onClick={closeMobile}
                    className="flex size-9 items-center justify-center rounded-md bg-foreground text-white hover:bg-foreground/90 mx-auto transition-colors"
                  >
                    <ShieldAlert className="size-4" aria-hidden />
                  </Link>
                </Tooltip>
              ) : (
                <Link
                  to="/admin"
                  onClick={closeMobile}
                  className="flex h-9 items-center gap-2.5 rounded-lg bg-foreground px-2.5 text-[12px] font-semibold text-white hover:bg-foreground/90 transition-colors shadow-xs"
                >
                  <ShieldAlert className="size-4 text-purple-300 shrink-0" aria-hidden />
                  <span className="truncate">Super Admin console</span>
                </Link>
              ))}
          </div>
        </aside>

        {/* Main Application Area */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Top Header */}
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 lg:px-6 shadow-xs z-10">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden text-muted"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation"
              >
                <Menu className="size-5" />
              </Button>

              {/* Quick Search Command Bar Button */}
              <button
                type="button"
                onClick={() => {
                  const input = document.getElementById("global-search");
                  input?.focus();
                }}
                className="hidden md:flex items-center gap-2 rounded-lg border border-border bg-surface-muted/60 px-3 py-1.5 text-xs text-muted hover:border-border-strong hover:bg-surface transition-colors w-64 text-left shadow-2xs"
              >
                <Search className="size-3.5 text-subtle shrink-0" />
                <span className="flex-1 truncate">Search or press ⌘K</span>
                <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] font-mono text-subtle">
                  ⌘K
                </kbd>
              </button>
            </div>

            <div className="flex items-center gap-3">
              <LiveIndicator />

              {user?.is_superadmin && (
                <Button variant="secondary" size="sm" asChild className="hidden sm:inline-flex shadow-2xs">
                  <Link to="/admin">
                    <ShieldAlert className="size-3.5 text-primary" />
                    <span>Super Admin</span>
                  </Link>
                </Button>
              )}

              <UserMenu />
            </div>
          </header>

          <VerifyEmailBanner />

          {current.support_session && (
            <div
              role="status"
              className="border-b border-info/20 bg-info-soft px-4 py-2 text-xs text-info lg:px-6 flex items-center justify-between"
            >
              <div>
                You are viewing <strong>{current.name}</strong> read-only as WFlow support, with the owner's permission
                {current.support_access_until && ` (until ${formatDateTime(current.support_access_until)})`}.
              </div>
            </div>
          )}

          {current.access_block === "billing_required" && (
            <div
              role="alert"
              className="border-b border-warning/25 bg-warning-soft px-4 py-2 text-xs text-warning lg:px-6"
            >
              Billing is required for this workspace. Choose a plan to continue using {current.name}.
            </div>
          )}

          {mustPay ? (
            <Navigate to="/billing" replace />
          ) : fullBleed ? (
            <main className="min-h-0 flex-1 overflow-hidden">
              <Outlet />
            </main>
          ) : (
            <main className="relative min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
                <Outlet />
              </div>
            </main>
          )}
        </div>

        <CreateOrganizationDialog open={createOpen} onOpenChange={setCreateOpen} />
      </div>
    </TooltipProvider>
  );
}

function WorkspaceClosed() {
  const { signOut } = useAuth();
  const { current, organizations, switchTo } = useOrganization();
  if (!current) return null;
  const pending = current.access_block === "pending";
  const others = organizations.filter((o) => o.id !== current.id && !o.access_block);

  return (
    <div className="flex h-full flex-col items-center justify-center px-4 text-center">
      <BrandMark className="mb-4 size-10" />
      <div
        className={cn(
          "mb-3 flex size-12 items-center justify-center rounded-full",
          pending ? "bg-warning-soft text-warning" : "bg-danger-soft text-danger",
        )}
      >
        {pending ? <Clock className="size-6" aria-hidden /> : <XCircle className="size-6" aria-hidden />}
      </div>
      <h1 className="text-lg font-bold">
        {pending ? `${current.name} is waiting for approval` : `${current.name} was not approved`}
      </h1>
      <p className="mt-1.5 max-w-md text-[13px] text-muted">
        {pending
          ? "Thanks for your request. Our team reviews new workspaces, usually within one business day. We'll email you as soon as it's approved."
          : current.rejection_reason || "Our team couldn't approve this request."}
      </p>
      {!pending && <p className="mt-2 text-xs text-muted">Questions? Reply to the email we sent you.</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-2.5">
        {pending && (
          <Button variant="secondary" onClick={() => window.location.reload()}>
            <RefreshCw className="size-4" /> Check again
          </Button>
        )}
        {others.map((o) => (
          <Button key={o.id} variant="secondary" onClick={() => switchTo(o.id)}>
            Open {o.name}
          </Button>
        ))}
        <Button variant="ghost" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

function NoOrganization({
  onCreate,
  createOpen,
  setCreateOpen,
  hadOrgs,
}: {
  onCreate: () => void;
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
  hadOrgs: boolean;
}) {
  const { signOut } = useAuth();
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 text-center">
      <BrandMark className="mb-4 size-10" />
      <h1 className="text-lg font-bold">
        {hadOrgs ? "Choose an organization" : "You're not in an organization yet"}
      </h1>
      <p className="mt-1.5 max-w-sm text-[13px] text-muted">
        Create an organization to get started, or ask an admin to invite you to theirs.
      </p>
      <div className="mt-6 flex gap-2.5">
        <Button onClick={onCreate}>
          <Plus className="size-4" /> Create organization
        </Button>
        <Button variant="secondary" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
      <CreateOrganizationDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

export function AppLayout() {
  return (
    <OrganizationProvider>
      <LiveUpdatesProvider>
        <Shell />
      </LiveUpdatesProvider>
    </OrganizationProvider>
  );
}
