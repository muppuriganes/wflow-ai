import { NavLink } from "react-router";
import { useCurrentOrg } from "@/stores/organization";
import { cn } from "@/utils/cn";

const TABS = [
  { to: "/contacts", label: "Contacts", permission: "contacts.read" },
  { to: "/leads", label: "Leads", permission: "leads.read" },
  { to: "/tasks", label: "Tasks", permission: "contacts.read" },
];

export function CrmTabs() {
  const org = useCurrentOrg();
  return (
    <nav className="mb-6 flex gap-1 border-b border-border" aria-label="CRM sections">
      {TABS.filter((t) => org.can(t.permission)).map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) =>
            cn(
              "-mb-px border-b-2 px-3 pb-2.5 text-xs font-semibold transition-colors",
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-muted hover:border-border hover:text-foreground",
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
