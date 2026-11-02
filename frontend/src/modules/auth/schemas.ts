import { z } from "zod";

/** Mirrors the backend password policy (app/schemas/auth.py). */
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128, "Use at most 128 characters")
  .regex(/[A-Za-z]/, "Include at least one letter")
  .regex(/\d/, "Include at least one number");

export const emailSchema = z.email("Enter a valid email address");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password"),
});

export const registerSchema = z.object({
  full_name: z.string().trim().min(1, "Enter your name").max(200),
  email: emailSchema,
  password: passwordSchema,
  organization_name: z.string().trim().min(2, "Use at least 2 characters").max(200),
  // About the business, for the team that reviews new organizations.
  business_type: z.string().trim().min(2, "Tell us what kind of business it is").max(120),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a phone number with country code"),
  team_size: z.enum(["1", "2-5", "6-20", "21-100", "100+"]),
  country: z.string().trim().max(120).optional(),
  website: z.string().trim().max(200).optional(),
  use_case: z.string().trim().max(1000).optional(),
});

/** Signing up from an invitation: the user joins that organization instead of creating one. */
export const inviteRegisterSchema = registerSchema.extend({
  organization_name: z.string().optional(),
  business_type: z.string().optional(),
  phone: z.string().optional(),
  team_size: z.string().optional(),
});

export const resetSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
export type ResetValues = z.infer<typeof resetSchema>;

/** Only allow in-app redirects after sign-in (prevents open redirects via ?next=). */
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
