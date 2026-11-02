import type { ReactNode } from "react";
import { Brand } from "@/components/brand";

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-10">
      <div className="mb-6">
        <Brand />
      </div>
      <main className="w-full max-w-[380px] rounded-lg border bg-surface p-6 shadow-card">
        <h1 className="text-base font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-muted">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </main>
      {footer && <div className="mt-4 text-[13px] text-muted">{footer}</div>}
      <p className="mt-8 text-xs text-subtle">Connect. Understand. Automate. Grow.</p>
    </div>
  );
}
