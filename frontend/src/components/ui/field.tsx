import { useId, type ReactElement, type ReactNode, cloneElement } from "react";
import { cn } from "@/utils/cn";

type FieldProps = {
  label: string;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  description?: ReactNode;
  className?: string;
  /** The control; receives id, aria-invalid and aria-describedby. */
  children: ReactElement<Record<string, unknown>>;
};

export function Field({ label, required, error, hint, description, className, children }: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const hintText = hint || description;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-xs font-medium text-foreground">
        {label}
        {required && <span className="ml-1 text-danger">*</span>}
      </label>
      {cloneElement(children, {
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error || hintText ? messageId : undefined,
      })}
      {error ? (
        <p id={messageId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hintText ? (
        <p id={messageId} className="text-xs text-muted">
          {hintText}
        </p>
      ) : null}
    </div>
  );
}
