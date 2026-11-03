import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/utils/cn";

export interface CardFooterProps extends ComponentProps<"footer"> {
  children?: ReactNode;
  divider?: boolean;
  className?: string;
}

export function CardFooter({ children, divider = true, className, ...props }: CardFooterProps) {
  return (
    <footer
      className={cn(
        "flex items-center justify-between text-xs text-muted pt-2",
        divider && "border-t border-border/60 pt-3",
        className
      )}
      {...props}
    >
      {children}
    </footer>
  );
}

