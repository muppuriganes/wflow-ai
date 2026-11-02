import { render, screen } from "@testing-library/react";
import { workspaceNav } from "@/app/navigation";
import { ComingSoonPage } from "./ComingSoonPage";

describe("ComingSoonPage", () => {
  it("states the module is unavailable and offers no actions", () => {
    const inbox = workspaceNav.find((i) => i.to === "/inbox")!;
    render(<ComingSoonPage item={inbox} />);
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.getByText("This module is not available yet")).toBeInTheDocument();
    expect(screen.getByText(/Milestone 3/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("every unbuilt nav item declares its milestone", () => {
    for (const item of workspaceNav.filter((i) => i.to !== "/")) {
      expect(item.milestone, item.label).toBeDefined();
    }
  });
});
