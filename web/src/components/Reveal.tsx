import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

/** Framer Motion's Easing type needs the literal to be a four-number tuple. */
const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

interface RevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
}

/** Fade and lift on first scroll into view; still under reduced motion, nothing animates. */
export function Reveal({ children, className, delay = 0 }: RevealProps) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
