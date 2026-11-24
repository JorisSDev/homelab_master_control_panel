import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function ToggleGroup({ className, ...props }: ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      className={cn("inline-flex items-center rounded-[4px] border border-[var(--line)] p-0.5", className)}
      {...props}
    />
  );
}

export function ToggleGroupItem({ className, ...props }: ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        "inline-flex h-8 items-center justify-center rounded-[4px] px-3 text-[15px] text-[var(--ink)] hover:bg-[rgba(243,239,230,0.08)] data-[state=on]:bg-[var(--accent)] data-[state=on]:text-[var(--accent-ink)] max-[760px]:min-h-11",
        className,
      )}
      {...props}
    />
  );
}
