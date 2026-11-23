import { useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

export function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  return (
    <details
      className="disclosure"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{summary}</summary>
      <motion.div
        className="fold"
        initial={false}
        animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
        transition={reduce ? { duration: 0 } : { type: "spring", bounce: 0, duration: 0.3 }}
      >
        <div className="fold-inner">{children}</div>
      </motion.div>
    </details>
  );
}
