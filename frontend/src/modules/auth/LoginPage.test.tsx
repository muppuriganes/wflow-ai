import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockFetch, renderRoute } from "@/test/render";
import { LoginPage } from "./LoginPage";

const session = {
  access_token: "token",
  token_type: "bearer",
  expires_in: 900,
  user: { id: "u1", email: "ada@example.com", full_name: "Ada", email_verified_at: null, is_superadmin: false, created_at: "2026-01-01T00:00:00Z" },
};

afterEach(() => vi.unstubAllGlobals());

describe("LoginPage", () => {
  it("validates fields before calling the API", async () => {
    const calls = mockFetch({ "POST /auth/refresh": { status: 401 } });
    renderRoute(<LoginPage />, { path: "/login" });
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByText("Enter your password")).toBeInTheDocument();
    expect(calls.filter((c) => c.path === "/auth/login")).toHaveLength(0);
  });

  it("shows the server error for bad credentials", async () => {
    mockFetch({
      "POST /auth/refresh": { status: 401 },
      "POST /auth/login": { status: 401, body: { error: { code: "invalid_credentials", message: "Invalid email or password" } } },
    });
    renderRoute(<LoginPage />, { path: "/login" });
    await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
  });

  it("signs in and follows a safe ?next= redirect", async () => {
    const calls = mockFetch({ "POST /auth/refresh": { status: 401 }, "POST /auth/login": { status: 200, body: session } });
    renderRoute(<LoginPage />, { path: "/login", url: "/login?next=%2Fteam", extraRoutes: ["/team"] });
    await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "Sup3r-secret");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByText("route:/team")).toBeInTheDocument());
    expect(calls.find((c) => c.path === "/auth/login")?.body).toEqual({ email: "ada@example.com", password: "Sup3r-secret" });
  });
});
