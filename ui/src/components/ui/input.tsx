import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const field =
  "h-9 w-full rounded-[4px] border border-[var(--line)] bg-[var(--canvas)] px-2 text-[15px] text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] max-[760px]:min-h-11";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(field, className)} {...props} />;
}
