import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function toneOf(value: string) {
  const tone = value.toLowerCase();
  if (tone.includes("down") || tone.includes("stop") || tone === "low" || tone.includes("different")) {
    return "down";
  }
  if (tone.includes("attention") || tone.includes("drift") || tone === "unknown") {
    return "attention";
  }
  if (tone.includes("run")) {
    return "running";
  }
  return "up";
}

export function Badge({ value, className, ...props }: HTMLAttributes<HTMLSpanElement> & { value: string }) {
  return (
    <span className={cn("status", `tone-${toneOf(value)}`, className)} {...props}>
      <span aria-hidden="true" className="status-mark" />
      {value}
    </span>
  );
}
