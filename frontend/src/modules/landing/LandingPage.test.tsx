import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockFetch, renderRoute } from "@/test/render";
import { LandingPage } from "./LandingPage";

afterEach(() => vi.unstubAllGlobals());

describe("LandingPage", () => {
  it("renders the hero headline, value props and call-to-actions", () => {
    mockFetch({ "POST /auth/refresh": { status: 401 } });
    renderRoute(<LandingPage />, { path: "/" });

    expect(
      screen.getByRole("heading", {
        name: /Automate WhatsApp, CRM & Operations with Visual Workflow Intelligence/i,
      }),
    ).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /Start 14-Day Free Trial/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Take the product tour/i })).toBeInTheDocument();
  });

  it("switches studio preview tabs between workflow, inbox, crm and telemetry", async () => {
    mockFetch({ "POST /auth/refresh": { status: 401 } });
    renderRoute(<LandingPage />, { path: "/" });

    // Workflow studio is default
    expect(screen.getByText(/WhatsApp Inbound Lead Qualification & Auto-Routing/i)).toBeInTheDocument();

    // Click Live Team Inbox tab
    await userEvent.click(screen.getByRole("button", { name: /Live Team Inbox/i }));
    expect(await screen.findByText(/Can we automate our delivery status dispatch\?/i)).toBeInTheDocument();

    // Click CRM Sales Pipeline tab
    await userEvent.click(screen.getByRole("button", { name: /CRM Sales Pipeline/i }));
    expect(await screen.findByText(/Fixed 7-Stage Sales Pipeline with Drag & Drop/i)).toBeInTheDocument();

    // Click Live Telemetry tab
    await userEvent.click(screen.getByRole("button", { name: /^Analytics$/i }));
    expect(await screen.findByText(/First Response Time/i)).toBeInTheDocument();
  });

  it("toggles billing interval between monthly and annual", async () => {
    mockFetch({ "POST /auth/refresh": { status: 401 } });
    renderRoute(<LandingPage />, { path: "/" });

    // Monthly default for Growth is $79
    expect(screen.getByText("$79")).toBeInTheDocument();

    // Switch to Annual billing
    await userEvent.click(screen.getByRole("button", { name: /Annual Billing/i }));
    // Annual discounted rate for Growth is $64
    expect(await screen.findByText("$64")).toBeInTheDocument();
  });

  it("expands and collapses FAQ accordion items", async () => {
    mockFetch({ "POST /auth/refresh": { status: 401 } });
    renderRoute(<LandingPage />, { path: "/" });

    // First FAQ is open by default
    expect(screen.getByText(/WFlow AI connects using an isolated gateway session/i)).toBeInTheDocument();

    // Click the second FAQ to expand it
    const secondFaq = screen.getByRole("button", { name: /How does tenant isolation work\? Can other companies see our data\?/i });
    await userEvent.click(secondFaq);
    expect(await screen.findByText(/PostgreSQL Row Level Security \(RLS\)/i)).toBeInTheDocument();
  });
});
