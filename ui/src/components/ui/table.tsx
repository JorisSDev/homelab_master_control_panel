import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full border-collapse text-left", className)} {...props} />;
}

export function TableHead({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("border-b border-[var(--line)] px-2 py-2 text-left text-[12px] font-medium text-[var(--muted)]", className)} {...props} />;
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-[var(--line)] px-2 py-2 align-middle", className)} {...props} />;
}
