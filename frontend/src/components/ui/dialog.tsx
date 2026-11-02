import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
};

export function Dialog({ open, onOpenChange, title, description, children, footer, size = "sm" }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-foreground/25" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-[8vh] z-50 w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border bg-surface shadow-overlay",
            size === "sm" && "max-w-md",
            size === "md" && "max-w-xl",
            size === "lg" && "max-w-3xl",
            size === "xl" && "max-w-5xl",
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b px-4 py-3">
            <div>
              <DialogPrimitive.Title className="text-sm font-semibold">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-0.5 text-xs text-muted">{description}</DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close className="rounded-sm p-0.5 text-muted hover:bg-surface-muted" aria-label="Close">
              <X className="size-4" />
            </DialogPrimitive.Close>
          </header>
          <div className="px-4 py-4">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t px-4 py-2.5">{footer}</footer>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

type ConfirmProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  loading?: boolean;
  danger?: boolean;
};

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm, loading, danger }: ConfirmProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <button
            type="button"
            className="h-8 rounded-md border border-border-strong bg-surface px-3 text-[13px] font-medium hover:bg-surface-muted"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={loading}
            className={cn(
              "h-8 rounded-md px-3 text-[13px] font-medium text-white disabled:opacity-50",
              danger ? "bg-danger hover:bg-danger/90" : "bg-primary hover:bg-primary-hover",
            )}
            onClick={onConfirm}
          >
            {loading ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-[13px] text-muted">{description}</div>
    </Dialog>
  );
}
