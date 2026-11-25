import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Alert({ className, tone = "neutral", ...props }: ComponentProps<"div"> & {
  tone?: "neutral" | "warning" | "error" | "success";
}) {
  return <div data-slot="alert" data-tone={tone} role={tone === "error" ? "alert" : "status"} className={cn("alert", className)} {...props} />;
}
