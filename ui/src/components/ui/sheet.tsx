import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps, ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Sheet({ children, ...props }: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root {...props}>{children}</DialogPrimitive.Root>;
}

export const SheetTrigger = DialogPrimitive.Trigger;

export function SheetContent({ className, children, side = "right", ...props }: ComponentProps<typeof DialogPrimitive.Content> & {
  children: ReactNode;
  side?: "right" | "bottom";
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="overlay-scrim" />
      <DialogPrimitive.Content
        className={cn("sheet-surface", className)}
        data-side={side}
        aria-describedby={undefined}
        {...props}
      >
        <DialogPrimitive.Close type="button" className="sheet-close" aria-label="Close">
          <X aria-hidden="true" />
        </DialogPrimitive.Close>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("overlay-title", className)} {...props} />;
}
