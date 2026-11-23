import { motion, useReducedMotion } from "motion/react";

const settle = { type: "spring" as const, bounce: 0, duration: 0.2 };

export function FadeText({ text, className }: { text: string; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      key={text}
      className={className}
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={reduce ? { duration: 0 } : settle}
    >
      {text}
    </motion.span>
  );
}
