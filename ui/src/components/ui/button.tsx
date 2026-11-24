import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[4px] text-[15px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:pointer-events-none disabled:opacity-45 max-[760px]:min-h-11",
  {
    variants: {
      variant: {
        default: "border border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)] hover:bg-[#e4dfd4]",
        outline: "border border-[var(--line)] bg-transparent text-[var(--ink)] hover:bg-[rgba(243,239,230,0.08)]",
        ghost: "border border-transparent bg-transparent text-[var(--ink)] hover:bg-[rgba(243,239,230,0.08)]",
      },
      size: {
        default: "h-9 px-3",
        icon: "size-9 p-0 max-[760px]:min-w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
