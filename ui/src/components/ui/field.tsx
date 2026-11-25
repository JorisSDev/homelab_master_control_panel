import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Field({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="field" className={cn("form-field", className)} {...props} />;
}

export function FieldLabel(props: ComponentProps<"label">) {
  return <label data-slot="field-label" {...props} />;
}

export function FieldError({ className, ...props }: ComponentProps<"p">) {
  return <p data-slot="field-error" className={cn("bad", className)} role="alert" {...props} />;
}
