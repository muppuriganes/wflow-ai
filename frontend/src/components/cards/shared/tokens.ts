import { cva, type VariantProps } from "class-variance-authority";

export type CardSize = "compact" | "default" | "large" | "featured";
export type CardAppearance = "minimal" | "outlined" | "elevated" | "tinted";
export type CardDensity = "comfortable" | "compact";

export const cardVariants = cva(
  "group relative flex flex-col justify-between overflow-hidden rounded-xl transition-all duration-200 text-foreground",
  {
    variants: {
      appearance: {
        minimal: "border-none bg-surface shadow-none",
        outlined: "border border-border bg-surface shadow-card hover:shadow-card-hover",
        elevated: "border border-border/80 bg-surface shadow-md hover:shadow-lg",
        tinted: "border border-primary/20 bg-primary-soft/40 shadow-card",
      },
      density: {
        comfortable: "p-5 gap-4",
        compact: "p-3.5 gap-2.5",
      },
      interactive: {
        true: "cursor-pointer hover:border-primary/50 hover:-translate-y-0.5 active:translate-y-0",
        false: "",
      },
    },
    defaultVariants: {
      appearance: "outlined",
      density: "comfortable",
      interactive: false,
    },
  }
);

export type CardVariantProps = VariantProps<typeof cardVariants>;

