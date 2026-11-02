import { render, screen } from "@testing-library/react";
import { workspaceNav } from "@/app/navigation";
import { ComingSoonPage } from "./ComingSoonPage";

describe("ComingSoonPage", () => {
  it("states the module is unavailable and offers no actions", () => {
    const workflows = workspaceNav.find((i) => i.to === "/workflows")!;
    render(<ComingSoonPage item={workflows} />);
    expect(screen.getByRole("heading", { name: "Workflows" })).toBeInTheDocument();
    expect(screen.getByText("This module is not available yet")).toBeInTheDocument();
    expect(screen.getByText(/Milestone 4/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("every unbuilt nav item declares its milestone", () => {
    for (const item of workspaceNav.filter((i) => !["/", "/channels", "/inbox", "/contacts"].includes(i.to))) {
      expect(item.milestone, item.label).toBeDefined();
    }
  });
});
