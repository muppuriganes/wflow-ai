import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/utils/cn";

export interface CardActionsProps extends ComponentProps<"div"> {
  children?: ReactNode;
  className?: string;
}

export function CardActions({ children, className, ...props }: CardActionsProps) {
  return (
    <div className={cn("flex items-center gap-1.5 shrink-0", className)} {...props}>
      {children}
    </div>
  );
}

