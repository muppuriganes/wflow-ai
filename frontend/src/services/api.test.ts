import { mockFetch } from "@/test/render";
import { api, ApiError, setAccessToken } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe("api client", () => {
  it("refreshes once on 401 and retries with the new token", async () => {
    let first = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/auth/refresh")) {
        return new Response(JSON.stringify({ access_token: "fresh", user: {} }), { status: 200 });
      }
      const auth = (init?.headers as Record<string, string>).Authorization;
      if (first) {
        first = false;
        return new Response(JSON.stringify({ error: { code: "token_expired", message: "expired" } }), { status: 401 });
      }
      return new Response(JSON.stringify({ auth }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    setAccessToken("stale");
    await expect(api<{ auth: string }>("/me")).resolves.toEqual({ auth: "Bearer fresh" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("exposes validation errors per field", async () => {
    mockFetch({
      "POST /auth/register": {
        status: 422,
        body: { error: { code: "validation_error", message: "Request validation failed", details: [{ field: "password", message: "Value error, Too weak" }] } },
      },
    });
    const err = await api("/auth/register", { method: "POST", body: {}, auth: false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).fieldErrors).toEqual({ password: "Too weak" });
  });

  it("turns network failures into a readable error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api("/me", { auth: false })).rejects.toMatchObject({ code: "network_error", status: 0 });
  });
});
