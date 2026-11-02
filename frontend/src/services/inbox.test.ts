import { contactName, initials, newClientId } from "@/modules/inbox/meta";
import { setAccessToken } from "./api";
import { type ChangeEvent, subscribeToChanges } from "./inbox";

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe("subscribeToChanges", () => {
  it("parses SSE frames split across chunks and sends the bearer token", async () => {
    const seen: ChangeEvent[] = [];
    const fetchMock = vi.fn(async () =>
      sseResponse([
        "retry: 3000\n: connected\n\n",
        'event: change\ndata: {"type":"message.cre',
        'ated","conversation_id":"c1"}\n\n: ping\n\nevent: change\ndata: {"type":"lead.updated","lead_id":"l1"}\n\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    setAccessToken("tok");
    const stop = subscribeToChanges("org-1", () => "tok", (e) => seen.push(e));
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    stop();
    expect(seen).toEqual([
      { type: "message.created", conversation_id: "c1" },
      { type: "lead.updated", lead_id: "l1" },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/organizations/org-1/events/stream");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
});

describe("inbox helpers", () => {
  it("names and initials", () => {
    expect(contactName({ display_name: null, phone_number: "919800000001" })).toBe("+919800000001");
    expect(contactName({ display_name: null, phone_number: null })).toBe("Unknown");
    expect(initials("Ravi Kumar")).toBe("RK");
    expect(initials("  ")).toBe("?");
  });

  it("client ids satisfy the API pattern", () => {
    const id = newClientId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(newClientId()).not.toBe(id);
  });
});
