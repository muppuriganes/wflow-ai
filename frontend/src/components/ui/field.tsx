import { useId, type ReactElement, type ReactNode, cloneElement } from "react";
import { cn } from "@/utils/cn";

type FieldProps = {
  label: string;
  error?: string;
  hint?: ReactNode;
  className?: string;
  /** The control; receives id, aria-invalid and aria-describedby. */
  children: ReactElement<Record<string, unknown>>;
};

export function Field({ label, error, hint, className, children }: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-xs font-medium text-foreground">
        {label}
      </label>
      {cloneElement(children, {
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error || hint ? messageId : undefined,
      })}
      {error ? (
        <p id={messageId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
