import { describeUserAgent, formatRelative, timezones } from "./format";

describe("describeUserAgent", () => {
  it("summarises common browsers", () => {
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36")).toBe(
      "Chrome on Windows",
    );
    expect(describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Gecko/20100101 Firefox/131.0")).toBe("Firefox on macOS");
    expect(describeUserAgent(null)).toBe("Unknown device");
  });
});

describe("formatRelative", () => {
  it("uses the largest sensible unit", () => {
    const now = Date.parse("2026-11-02T12:00:00Z");
    expect(formatRelative("2026-11-02T11:00:00Z", now)).toMatch(/hour/);
    expect(formatRelative("2026-11-09T12:00:00Z", now)).toMatch(/7 days|in 7/);
  });
});

describe("timezones", () => {
  it("always offers UTC, the platform default", () => {
    expect(timezones()).toContain("UTC");
  });
});
