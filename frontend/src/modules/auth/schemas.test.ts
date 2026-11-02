import { passwordSchema, registerSchema, safeNext } from "./schemas";

describe("passwordSchema", () => {
  it("matches the backend policy", () => {
    expect(passwordSchema.safeParse("short1").success).toBe(false);
    expect(passwordSchema.safeParse("onlyletters").success).toBe(false);
    expect(passwordSchema.safeParse("1234567890").success).toBe(false);
    expect(passwordSchema.safeParse("letters-and-1").success).toBe(true);
  });
});

describe("registerSchema", () => {
  const business = { business_type: "Bakery", phone: "+91 98000 12345", team_size: "2-5" as const };

  it("trims names and validates email", () => {
    const ok = registerSchema.safeParse({
      full_name: "  Ada  ",
      email: "ada@example.com",
      password: "Sup3r-secret",
      organization_name: "Acme",
      ...business,
    });
    expect(ok.success && ok.data.full_name).toBe("Ada");
    expect(registerSchema.safeParse({ full_name: "A", email: "nope", password: "x", organization_name: "A", ...business }).success).toBe(false);
  });

  it("asks new organizations about their business", () => {
    const base = { full_name: "Ada", email: "ada@example.com", password: "Sup3r-secret", organization_name: "Acme" };
    expect(registerSchema.safeParse(base).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, ...business, phone: "call me" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, ...business }).success).toBe(true);
  });
});

describe("safeNext", () => {
  it("only allows in-app paths", () => {
    expect(safeNext("/team")).toBe("/team");
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});
