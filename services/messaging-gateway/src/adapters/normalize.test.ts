import { describe, expect, it } from "vitest";
import { isCustomerMessage, mapAck, normalizeMessage } from "./normalize.js";

const base = {
  id: { _serialized: "false_1@c.us_X" },
  from: "919800000001@c.us",
  body: "",
  type: "chat",
  timestamp: 1_790_000_000,
  fromMe: false,
  isStatus: false,
};

describe("normalizeMessage", () => {
  it("maps library types to neutral types and keeps captions", () => {
    expect(normalizeMessage({ ...base, type: "ptt" }).message_type).toBe("audio");
    expect(normalizeMessage({ ...base, type: "image", body: "Invoice photo" })).toMatchObject({
      message_type: "image",
      content: "Invoice photo",
    });
    expect(normalizeMessage({ ...base, type: "poll_creation" }).message_type).toBe("unsupported");
    expect(normalizeMessage({ ...base, body: "  " }).content).toBeUndefined();
  });

  it("uses the author as sender in groups", () => {
    const n = normalizeMessage({ ...base, from: "1203630@g.us", author: "919811111111@c.us" });
    expect(n).toMatchObject({ is_group: true, chat_id: "1203630@g.us", sender: "919811111111@c.us", sender_phone: "919811111111" });
  });

  it("converts the provider timestamp to ISO", () => {
    expect(normalizeMessage(base).provider_timestamp).toBe(new Date(1_790_000_000 * 1000).toISOString());
  });
});

describe("mapAck / isCustomerMessage", () => {
  it("reports only observed delivery states", () => {
    expect([-1, 0, 1, 2, 3, 4, 9].map(mapAck)).toEqual(["failed", null, "sent", "delivered", "read", "played", null]);
  });
  it("filters own and status messages", () => {
    expect(isCustomerMessage(base)).toBe(true);
    expect(isCustomerMessage({ ...base, fromMe: true })).toBe(false);
    expect(isCustomerMessage({ ...base, from: "status@broadcast" })).toBe(false);
  });
});
