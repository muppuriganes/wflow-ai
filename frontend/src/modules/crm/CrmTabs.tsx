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
    <nav className="mb-5 flex gap-4 border-b" aria-label="CRM sections">
      {TABS.filter((t) => org.can(t.permission)).map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) =>
            cn(
              "-mb-px border-b-2 border-transparent pb-2 text-[13px] font-medium text-muted hover:text-foreground",
              isActive && "border-primary text-foreground",
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
