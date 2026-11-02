import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { ApiError, errorMessage } from "@/services/api";

/**
 * Maps an API error onto a react-hook-form: validation errors go to their fields,
 * anything else becomes a form-level message (returned for display).
 */
export function applyServerErrors<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>, fields: readonly Path<T>[]): string | null {
  if (err instanceof ApiError) {
    const fieldErrors = err.fieldErrors;
    let mapped = false;
    for (const field of fields) {
      const message = fieldErrors[field];
      if (message) {
        setError(field, { message });
        mapped = true;
      }
    }
    if (mapped) return null;
  }
  return errorMessage(err);
}
