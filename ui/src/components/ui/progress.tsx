import * as ProgressPrimitive from "@radix-ui/react-progress";

export function Progress({ value, low = false, label }: { value: number; low?: boolean; label?: string }) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <ProgressPrimitive.Root className="relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--line)]" value={width} aria-label={label}>
      <ProgressPrimitive.Indicator
        className={low ? "h-full rounded-full bg-[var(--down)]" : "h-full rounded-full bg-[var(--accent)]"}
        style={{ width: `${width}%` }}
      />
    </ProgressPrimitive.Root>
  );
}
