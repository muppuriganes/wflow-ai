import { render, screen } from "@testing-library/react";
import { workspaceNav } from "@/app/navigation";
import { ComingSoonPage } from "./ComingSoonPage";

describe("ComingSoonPage", () => {
  it("states the module is unavailable and offers no actions", () => {
    const integrations = workspaceNav.find((i) => i.to === "/integrations")!;
    render(<ComingSoonPage item={integrations} />);
    expect(screen.getByRole("heading", { name: "Integrations" })).toBeInTheDocument();
    expect(screen.getByText("This module is not available yet")).toBeInTheDocument();
    expect(screen.getByText(/Milestone 6/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("every unbuilt nav item declares its milestone", () => {
    const built = [
      "/",
      "/channels",
      "/inbox",
      "/contacts",
      "/workflows",
      "/executions",
      "/schedules",
      "/templates",
      "/analytics",
    ];
    for (const item of workspaceNav.filter((i) => !built.includes(i.to))) {
      expect(item.milestone, item.label).toBeDefined();
    }
  });
});
