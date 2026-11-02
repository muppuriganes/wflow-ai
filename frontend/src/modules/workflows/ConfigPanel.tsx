import { Copy, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import type { Issue, NodeField, NodeType } from "@/types/api";
import { cn } from "@/utils/cn";
import { CATEGORIES, type Lookups } from "./meta";

const VARIABLES = ["contact.name", "contact.phone", "message.text", "org.name", "variables.<name>"];

type Props = {
  def: NodeType;
  config: Record<string, unknown>;
  issues: Issue[];
  lookups: Lookups;
  readOnly: boolean;
  onChange: (config: Record<string, unknown>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onClose: () => void;
};

export function ConfigPanel({ def, config, issues, lookups, readOnly, onChange, onDelete, onDuplicate, onClose }: Props) {
  const cat = CATEGORIES[def.category];
  const Icon = cat.icon;
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });
  const isTrigger = def.category === "trigger";

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start gap-2 border-b px-4 py-3">
        <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md", cat.accent)}>
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{def.label}</h2>
          <p className="text-xs text-muted">{def.description}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close settings">
          <X />
        </Button>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {issues.map((i) => (
          <p key={i.message} role="alert" className="rounded-md bg-danger-soft px-2.5 py-1.5 text-xs text-danger">
            {i.message}
          </p>
        ))}
        {def.fields.length === 0 && <p className="text-xs text-muted">This step has no settings.</p>}
        {def.fields.map((f) => (
          <FieldInput key={f.key} field={f} value={config[f.key]} lookups={lookups} disabled={readOnly} onChange={(v) => set(f.key, v)} />
        ))}
        {def.fields.some((f) => f.templated) && (
          <div className="rounded-md border border-dashed p-2.5 text-xs text-muted">
            <p className="font-medium text-foreground">Personalise text</p>
            <p className="mt-0.5">Insert details with double braces, for example:</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {VARIABLES.map((v) => (
                <code key={v} className="rounded-sm bg-surface-muted px-1 py-0.5 text-[11px]">{`{{${v}}}`}</code>
              ))}
            </div>
          </div>
        )}
        {def.side_effects && (
          <p className="text-xs text-muted">In a test run this step is only described, nothing is sent or changed.</p>
        )}
      </div>
      {!readOnly && (
        <footer className="flex gap-2 border-t px-4 py-3">
          {!isTrigger && (
            <Button variant="secondary" size="sm" onClick={onDuplicate}>
              <Copy /> Duplicate
            </Button>
          )}
          <Button variant="danger-outline" size="sm" onClick={onDelete}>
            <Trash2 /> Delete step
          </Button>
        </footer>
      )}
    </div>
  );
}

function FieldInput({
  field: f,
  value,
  lookups,
  disabled,
  onChange,
}: {
  field: NodeField;
  value: unknown;
  lookups: Lookups;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const label = f.required ? f.label : `${f.label} (optional)`;
  const hint = f.help || undefined;
  const str = value === undefined || value === null ? "" : String(value);

  switch (f.type) {
    case "textarea":
      return (
        <Field label={label} hint={hint}>
          <textarea
            className="min-h-24 w-full rounded-md border border-border-strong bg-surface px-2.5 py-2 text-[13px] focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/15 disabled:bg-surface-muted"
            value={str}
            maxLength={f.max_length}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        </Field>
      );
    case "number":
      return (
        <Field label={label} hint={hint}>
          <Input
            type="number"
            value={str}
            min={f.min ?? undefined}
            max={f.max ?? undefined}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          />
        </Field>
      );
    case "time":
      return (
        <Field label={label} hint={hint}>
          <Input type="time" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
        </Field>
      );
    case "select":
    case "tag":
    case "user":
    case "connection":
    case "credential": {
      const options = {
        select: f.options,
        tag: lookups.tags,
        user: lookups.users,
        connection: lookups.connections,
        credential: lookups.credentials,
      }[f.type];
      return (
        <Field label={label} hint={hint}>
          <NativeSelect value={str} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
            {(!f.required || !str) && <option value="">{f.type === "connection" ? "Any number" : f.type === "credential" ? "None" : "Choose…"}</option>}
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      );
    }
    case "multiselect": {
      const selected = new Set((value as string[] | undefined) ?? []);
      return (
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium">{label}</legend>
          <div className="flex flex-wrap gap-1">
            {f.options.map((o) => {
              const on = selected.has(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() => onChange(f.options.map((x) => x.value).filter((v) => (v === o.value ? !on : selected.has(v))))}
                  className={cn(
                    "h-7 rounded-md border px-2 text-xs",
                    on ? "border-primary bg-primary-soft text-primary" : "border-border-strong text-muted hover:bg-surface-muted",
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
        </fieldset>
      );
    }
    case "keywords":
      return <KeywordsInput label={label} hint={hint} value={(value as string[] | undefined) ?? []} disabled={disabled} onChange={onChange} />;
    default:
      return (
        <Field label={label} hint={hint}>
          <Input value={str} maxLength={f.max_length} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
        </Field>
      );
  }
}

function KeywordsInput({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string[];
  disabled: boolean;
  onChange: (value: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const words = draft.split(",").map((w) => w.trim()).filter((w) => w && !value.includes(w));
    if (words.length) onChange([...value, ...words]);
    setDraft("");
  };
  return (
    <Field label={label} hint={hint ?? "Press Enter or comma to add. Whole words, not case sensitive."}>
      <div className="rounded-md border border-border-strong p-1.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
        {value.length > 0 && (
          <div className="mb-1 flex flex-wrap gap-1">
            {value.map((w) => (
              <span key={w} className="inline-flex items-center gap-1 rounded-sm bg-primary-soft px-1.5 py-0.5 text-xs text-primary">
                {w}
                {!disabled && (
                  <button type="button" onClick={() => onChange(value.filter((x) => x !== w))} aria-label={`Remove ${w}`}>
                    <X className="size-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        <input
          className="h-6 w-full bg-transparent px-1 text-[13px] outline-none"
          value={draft}
          disabled={disabled}
          placeholder="Add a keyword"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            } else if (e.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
        />
      </div>
    </Field>
  );
}
