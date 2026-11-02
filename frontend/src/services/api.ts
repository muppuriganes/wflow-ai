/**
 * HTTP client for the WFlow API.
 *
 * - The access token lives only in memory (never localStorage), so XSS cannot read a long-lived credential.
 * - The refresh token is an httpOnly cookie scoped to /api/v1/auth; the browser sends it, JS never sees it.
 * - On a 401 the client refreshes once and retries. Refreshes are single-flight within a tab and
 *   serialised across tabs with the Web Locks API, because refresh tokens rotate and a parallel
 *   refresh with the old cookie would be treated as token theft by the server.
 */
import type { TokenResponse } from "@/types/api";

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8100/api/v1";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Field-level messages from a 422 validation error, keyed by field name. */
  get fieldErrors(): Record<string, string> {
    if (this.code !== "validation_error" || !Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const item of this.details as { field?: string; message?: string }[]) {
      if (item.field && item.message) out[item.field] = item.message.replace(/^Value error, /, "");
    }
    return out;
  }
}

let accessToken: string | null = null;
let refreshInFlight: Promise<TokenResponse | null> | null = null;
let sessionListener: ((session: TokenResponse | null) => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Called whenever a refresh succeeds or the session ends, so UI state stays in sync. */
export function onSessionChange(listener: (session: TokenResponse | null) => void): void {
  sessionListener = listener;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: { error?: { message?: string; code?: string; details?: unknown; request_id?: string } } = {};
  try {
    body = await res.json();
  } catch {
    // Non-JSON error (e.g. a proxy page); fall through to a generic message.
  }
  const err = body.error;
  return new ApiError(
    err?.message ?? `Request failed (${res.status})`,
    res.status,
    err?.code ?? "http_error",
    err?.details,
    err?.request_id ?? res.headers.get("x-request-id") ?? undefined,
  );
}

async function doRefresh(): Promise<TokenResponse | null> {
  const res = await fetch(`${API_BASE_URL}/auth/refresh`, { method: "POST", credentials: "include" });
  if (!res.ok) return null;
  return (await res.json()) as TokenResponse;
}

export function refreshSession(): Promise<TokenResponse | null> {
  if (!refreshInFlight) {
    const run = async () => {
      try {
        const session = navigator.locks
          ? await navigator.locks.request("wflow-auth-refresh", doRefresh)
          : await doRefresh();
        setAccessToken(session?.access_token ?? null);
        sessionListener?.(session);
        return session;
      } catch {
        // Network failure: keep current state, the caller surfaces the error.
        return null;
      } finally {
        refreshInFlight = null;
      }
    };
    refreshInFlight = run();
  }
  return refreshInFlight;
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Multipart upload; the browser sets the Content-Type boundary. */
  form?: FormData;
  /** Send the access token (default true). */
  auth?: boolean;
  signal?: AbortSignal;
};

export async function api<T>(path: string, { method = "GET", body, form, auth = true, signal }: RequestOptions = {}): Promise<T> {
  const send = () => {
    const headers: Record<string, string> = {};
    if (body !== undefined && !form) headers["Content-Type"] = "application/json";
    if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
      credentials: "include",
      signal,
    });
  };

  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && auth) {
      const session = await refreshSession();
      if (!session) throw new ApiError("Your session has ended. Please sign in again.", 401, "session_ended");
      res = await send();
    }
  } catch (err) {
    if (err instanceof ApiError || (err instanceof DOMException && err.name === "AbortError")) throw err;
    throw new ApiError("Cannot reach the server. Check your connection and try again.", 0, "network_error");
  }

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
