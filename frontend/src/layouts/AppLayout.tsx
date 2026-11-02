import { Building2, Check, ChevronsUpDown, Clock, LogOut, Menu, Plus, RefreshCw, Settings, X, XCircle } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useMatch, useNavigate } from "react-router";
import { adminNav, type NavItem, platformAdminNav, workspaceNav } from "@/app/navigation";
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
import { CreateOrganizationDialog } from "@/modules/settings/CreateOrganizationDialog";
import { errorMessage } from "@/services/api";
import { useAuth } from "@/stores/auth";
import { LiveUpdatesProvider, useLive } from "@/stores/live";
import { OrganizationProvider, useOrganization } from "@/stores/organization";
import { cn } from "@/utils/cn";
import { formatDateTime } from "@/utils/format";
import { VerifyEmailBanner } from "./VerifyEmailBanner";

function NavSection({ title, items, onNavigate }: { title: string; items: NavItem[]; onNavigate: () => void }) {
  const { pathname } = useLocation();
  return (
    <div>
      <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-subtle">{title}</p>
      <ul className="space-y-px">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === "/"}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-muted hover:bg-surface-muted hover:text-foreground",
                  (isActive || item.also?.some((p) => pathname.startsWith(p))) &&
                    "bg-primary-soft font-medium text-primary hover:bg-primary-soft hover:text-primary",
                )
              }
            >
              <item.icon className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{item.label}</span>
              {item.milestone && (
                <span className="ml-auto rounded-sm bg-surface-muted px-1 text-[10px] font-medium text-subtle">Soon</span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OrgSwitcher({ onCreate }: { onCreate: () => void }) {
  const { organizations, current, switchTo } = useOrganization();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md border bg-surface px-2 py-1.5 text-left hover:bg-surface-muted">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-primary-soft text-[11px] font-semibold text-primary">
          {current?.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{current?.name}</span>
          <span className="block truncate text-[11px] text-muted">
            {current?.support_session ? "Support · read-only" : current?.role.name}
          </span>
        </span>
        <ChevronsUpDown className="size-3.5 text-subtle" aria-hidden />
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
            <Building2 />
            <span className="flex-1 truncate">{org.name}</span>
            {org.support_session && <span className="text-[10px] text-info">support</span>}
            {org.access_block === "pending" && <span className="text-[10px] text-warning">pending</span>}
            {org.id === current?.id && <Check className="!text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCreate}>
          <Plus />
          New organization
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
    <span className="hidden items-center gap-1.5 text-[11px] text-muted sm:inline-flex" title={live ? "Updates arrive instantly" : "Reconnecting — updates may be delayed"}>
      <span className={cn("size-1.5 rounded-full", live ? "bg-success" : "bg-warning")} aria-hidden />
      {live ? "Live" : "Connecting"}
    </span>
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
        className="flex size-8 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-white"
        aria-label="Account menu"
      >
        {initials}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <div className="px-2 py-1.5">
          <p className="truncate text-[13px] font-medium">{user.full_name}</p>
          <p className="truncate text-xs text-muted">{user.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/settings")}>
          <Settings />
          Account settings
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={async () => {
            await signOut();
            navigate("/login");
          }}
        >
          <LogOut />
          Sign out
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
  const inInbox = useMatch("/inbox/*") !== null;
  const inBuilder = useMatch("/workflows/:workflowId") !== null;
  const fullBleed = inInbox || inBuilder;
  const onBilling = useMatch("/billing") !== null;

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
    return <NoOrganization onCreate={() => setCreateOpen(true)} createOpen={createOpen} setCreateOpen={setCreateOpen} hadOrgs={organizations.length > 0} />;
  }
  if (current.access_block === "pending" || current.access_block === "rejected") {
    return <WorkspaceClosed />;
  }
  const mustPay = current.access_block === "billing_required" && !onBilling;

  const closeMobile = () => setMobileOpen(false);
  return (
    <div className="flex h-full">
      {mobileOpen && <div className="fixed inset-0 z-30 bg-foreground/20 lg:hidden" onClick={closeMobile} aria-hidden />}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r bg-surface transition-transform lg:static lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Main navigation"
      >
        <div className="flex h-13 items-center justify-between px-4">
          <Link to="/" className="inline-flex items-center gap-2" onClick={closeMobile}>
            <BrandMark className="size-6" />
            <span className="text-sm font-semibold tracking-tight">WFlow AI</span>
          </Link>
          <button className="rounded-sm p-1 text-muted lg:hidden" onClick={closeMobile} aria-label="Close navigation">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-3 pb-3">
          <OrgSwitcher onCreate={() => setCreateOpen(true)} />
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
          <NavSection title="Workspace" items={workspaceNav} onNavigate={closeMobile} />
          <NavSection title="Administration" items={adminNav} onNavigate={closeMobile} />
          {user?.is_superadmin && (
            <NavSection title="Platform" items={platformAdminNav} onNavigate={closeMobile} />
          )}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-13 shrink-0 items-center justify-between gap-3 border-b bg-surface px-4 lg:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <div className="hidden text-xs text-muted lg:block">{current.name}</div>
          <div className="flex items-center gap-3">
            <LiveIndicator />
            <UserMenu />
          </div>
        </header>
        <VerifyEmailBanner />
        {current.support_session && (
          <div role="status" className="border-b border-info/20 bg-info-soft px-4 py-2 text-xs text-info lg:px-6">
            You are viewing <strong>{current.name}</strong> read-only as WFlow support, with the owner's permission
            {current.support_access_until && ` (until ${formatDateTime(current.support_access_until)})`}. Every visit is
            logged and visible to the owner.
          </div>
        )}
        {current.access_block === "billing_required" && (
          <div role="alert" className="border-b border-warning/25 bg-warning-soft px-4 py-2 text-xs text-warning lg:px-6">
            Billing is required for this workspace. Choose a plan to continue using {current.name}.
          </div>
        )}
        {mustPay ? (
          <Navigate to="/billing" replace />
        ) : fullBleed ? (
          // Workspace screens like the inbox and the workflow builder manage their own panes and scrolling.
          <main className="min-h-0 flex-1 overflow-hidden">
            <Outlet />
          </main>
        ) : (
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-6">
              <Outlet />
            </div>
          </main>
        )}
      </div>
      <CreateOrganizationDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

/** A workspace that is waiting for approval, or was not approved. */
function WorkspaceClosed() {
  const { signOut } = useAuth();
  const { current, organizations, switchTo } = useOrganization();
  if (!current) return null;
  const pending = current.access_block === "pending";
  const others = organizations.filter((o) => o.id !== current.id && !o.access_block);
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 text-center">
      <BrandMark className="mb-4 size-9" />
      <div className={cn("mb-3 flex size-10 items-center justify-center rounded-full", pending ? "bg-warning-soft text-warning" : "bg-danger-soft text-danger")}>
        {pending ? <Clock className="size-5" aria-hidden /> : <XCircle className="size-5" aria-hidden />}
      </div>
      <h1 className="text-base font-semibold">
        {pending ? `${current.name} is waiting for approval` : `${current.name} was not approved`}
      </h1>
      <p className="mt-1 max-w-md text-[13px] text-muted">
        {pending
          ? "Thanks for your request. Our team reviews new workspaces, usually within one business day. We'll email you as soon as it's approved."
          : current.rejection_reason || "Our team couldn't approve this request."}
      </p>
      {!pending && <p className="mt-2 text-xs text-muted">Questions? Reply to the email we sent you.</p>}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {pending && (
          <Button variant="secondary" onClick={() => window.location.reload()}>
            <RefreshCw /> Check again
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
      <BrandMark className="mb-4 size-9" />
      <h1 className="text-base font-semibold">{hadOrgs ? "Choose an organization" : "You're not in an organization yet"}</h1>
      <p className="mt-1 max-w-sm text-[13px] text-muted">
        Create an organization to get started, or ask an admin to invite you to theirs.
      </p>
      <div className="mt-5 flex gap-2">
        <Button onClick={onCreate}>
          <Plus /> Create organization
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
