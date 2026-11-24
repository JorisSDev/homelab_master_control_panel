import * as ProgressPrimitive from "@radix-ui/react-progress";

export function Progress({ value, low = false }: { value: number; low?: boolean }) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <ProgressPrimitive.Root className="relative h-1 w-full overflow-hidden bg-[var(--line)]" value={width}>
      <ProgressPrimitive.Indicator
        className={low ? "h-full bg-[var(--down)]" : "h-full bg-[var(--accent)]"}
        style={{ width: `${width}%` }}
      />
    </ProgressPrimitive.Root>
  );
}
