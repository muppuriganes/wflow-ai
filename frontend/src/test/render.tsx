import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AuthProvider } from "@/stores/auth";

/** Renders `element` at `path` inside the real providers. Extra routes record navigation targets. */
type RouteOptions = { path?: string; url?: string; extraRoutes?: string[] };

export function renderRoute(element: ReactElement, { path = "/", url, extraRoutes = [] }: RouteOptions = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [{ path, element }, ...extraRoutes.map((p) => ({ path: p, element: <p>route:{p}</p> }))],
    { initialEntries: [url ?? path] },
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

type MockResponse = { status: number; body?: unknown };

/** Routes fetch calls by "METHOD /path" to canned responses; records every call. */
export function mockFetch(routes: Record<string, MockResponse>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = url.pathname.replace(/^\/api\/v1/, "");
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const match = routes[`${method} ${path}`];
    if (!match) return new Response(JSON.stringify({ error: { code: "not_found", message: "no mock" } }), { status: 404 });
    return new Response(match.status === 204 ? null : JSON.stringify(match.body ?? {}), {
      status: match.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}
