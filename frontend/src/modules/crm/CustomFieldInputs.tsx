import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import type { CustomField } from "@/types/api";

/** Form inputs for organization-defined fields. Values are validated again by the API. */
export function CustomFieldInputs({
  fields,
  values,
  onChange,
  disabled,
}: {
  fields: CustomField[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
}) {
  if (!fields.length) return null;
  return (
    <>
      {fields.map((f) => {
        const label = f.required ? `${f.label} *` : f.label;
        const value = values[f.key];
        switch (f.field_type) {
          case "select":
            return (
              <Field key={f.key} label={label}>
                <NativeSelect disabled={disabled} value={(value as string) ?? ""} onChange={(e) => onChange(f.key, e.target.value || null)}>
                  <option value="">—</option>
                  {f.options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </NativeSelect>
              </Field>
            );
          case "boolean":
            return (
              <label key={f.key} className="flex items-center gap-2 self-end pb-1.5 text-[13px]">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={value === true}
                  onChange={(e) => onChange(f.key, e.target.checked)}
                  className="accent-[var(--color-primary)]"
                />
                {f.label}
              </label>
            );
          default:
            return (
              <Field key={f.key} label={label}>
                <Input
                  disabled={disabled}
                  type={f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text"}
                  value={value === undefined || value === null ? "" : String(value)}
                  onChange={(e) => onChange(f.key, e.target.value === "" ? null : e.target.value)}
                />
              </Field>
            );
        }
      })}
    </>
  );
}

export function formatCustomValue(field: CustomField, value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (field.field_type === "boolean") return value ? "Yes" : "No";
  if (field.field_type === "date") return new Date(`${String(value)}T00:00:00`).toLocaleDateString();
  return String(value);
}
