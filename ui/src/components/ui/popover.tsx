import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Popover({ ...props }: ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root {...props} />;
}

export function PopoverTrigger({ ...props }: ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger {...props} />;
}

export function PopoverContent({ className, align = "start", sideOffset = 6, ...props }: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-20 w-[min(22rem,calc(100vw-2rem))] border border-[var(--line)] bg-[var(--paper)] p-3 shadow-[0_16px_40px_rgba(0,0,0,0.45)]",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
