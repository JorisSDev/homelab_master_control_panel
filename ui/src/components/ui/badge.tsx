import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function toneOf(value: string) {
  const tone = value.toLowerCase();
  if (["down", "stopped", "low", "issue", "different disk", "failed"].includes(tone)) {
    return "down";
  }
  if (tone.includes("attention") || tone.includes("drift") || tone === "review" || tone === "incomplete") {
    return "attention";
  }
  if (tone.includes("running") && tone !== "running") {
    return "running";
  }
  return ["up", "running", "completed", "passed", "ready"].includes(tone) ? "up" : "neutral";
}

export function Badge({ value, className, ...props }: HTMLAttributes<HTMLSpanElement> & { value: string }) {
  return (
    <span className={cn("status", `tone-${toneOf(value)}`, className)} {...props}>
      <span aria-hidden="true" className="status-mark" />
      {value}
    </span>
  );
}
