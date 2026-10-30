import type { ReactNode } from 'react';
import { Reveal } from './Reveal';

interface SectionProps {
  id: string;
  eyebrow?: string;
  title?: string;
  lead?: string;
  children?: ReactNode;
}

/** Shared frame for every anchored block below the story. */
export function Section({ id, eyebrow, title, lead, children }: SectionProps) {
  return (
    <section id={id} className="relative scroll-mt-16 border-t border-white/5 px-6 py-24 md:py-32">
      <div className="mx-auto w-full max-w-content">
        {title === undefined ? null : (
          <Reveal className="max-w-2xl">
            {eyebrow === undefined ? null : (
              <span className="text-[0.65rem] uppercase tracking-[0.35em] text-accent">
                {eyebrow}
              </span>
            )}
            <h2 className="mt-4 text-[clamp(1.75rem,4vw,2.9rem)] font-semibold leading-tight tracking-tight text-mist-100">
              {title}
            </h2>
            {lead === undefined ? null : (
              <p className="mt-4 text-sm leading-relaxed text-mist-500 md:text-base">{lead}</p>
            )}
          </Reveal>
        )}
        {children}
      </div>
    </section>
  );
}
