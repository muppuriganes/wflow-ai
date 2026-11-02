import { render, screen } from "@testing-library/react";
import { workspaceNav } from "@/app/navigation";
import { ComingSoonPage } from "./ComingSoonPage";

describe("ComingSoonPage", () => {
  it("states the module is unavailable and offers no actions", () => {
    const schedules = workspaceNav.find((i) => i.to === "/schedules")!;
    render(<ComingSoonPage item={schedules} />);
    expect(screen.getByRole("heading", { name: "Schedules" })).toBeInTheDocument();
    expect(screen.getByText("This module is not available yet")).toBeInTheDocument();
    expect(screen.getByText(/Milestone 5/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("every unbuilt nav item declares its milestone", () => {
    for (const item of workspaceNav.filter((i) => !["/", "/channels", "/inbox", "/contacts", "/workflows", "/executions"].includes(i.to))) {
      expect(item.milestone, item.label).toBeDefined();
    }
  });
});
