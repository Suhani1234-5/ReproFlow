import type { MouseEvent } from 'react';
import { Reveal } from './Reveal';
import { Section } from './Section';

interface Feature {
  title: string;
  body: string;
}

const FEATURES: readonly Feature[] = [
  {
    title: 'Record without asking for the web',
    body: 'The recorder runs from activeTab and scripting alone: no broad host permissions, and it stops the moment you hit stop.',
  },
  {
    title: 'Steps become deterministic specs',
    body: 'Locators are picked in order — role, label, test id, text, then CSS — and repeated typing collapses into a single fill.',
  },
  {
    title: 'Verified locally, three times',
    body: 'A Playwright runner on 127.0.0.1 replays the spec in an isolated context. You get three attempts at the same failure, or it is not reproduced.',
  },
  {
    title: 'Duplicate-aware by fingerprint',
    body: 'The steps, the failing assertion and the page URL hash into one fingerprint. A bug you already filed gets a comment instead of a new issue.',
  },
  {
    title: 'Evidence on a branch',
    body: 'reproduction.spec.ts and the screenshots are committed to reproflow/<report-id>. If that write is refused, the test is embedded in the issue itself.',
  },
  {
    title: 'Nothing is sent until you say so',
    body: 'Every run produces a report you can preview, export as JSON, Markdown or ZIP, and throw away — no account, no server in the middle.',
  },
];

/** Writes the cursor position into the card so the CSS ring follows it, without a React render. */
function trackGlow(event: MouseEvent<HTMLElement>): void {
  const card = event.currentTarget;
  const rect = card.getBoundingClientRect();
  card.style.setProperty('--glow-x', `${event.clientX - rect.left}px`);
  card.style.setProperty('--glow-y', `${event.clientY - rect.top}px`);
}

export function Features() {
  return (
    <Section
      id="features"
      eyebrow="Features"
      title="A recorder, a generator and a verifier that stay out of your way."
      lead="Six things ReproFlow does for every bug you find — and the boundaries it refuses to cross."
    >
      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature, index) => (
          <Reveal key={feature.title} className="h-full" delay={index * 0.05}>
            <article
              onMouseMove={trackGlow}
              // z-0 makes the card a stacking context so the glow sits behind the text.
              className="glow-card relative z-0 h-full rounded-2xl border border-white/10 bg-white/[0.02] p-6 transition-colors hover:border-white/20"
            >
              <span className="font-mono text-[0.65rem] text-mist-700">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-4 text-base font-medium tracking-tight text-mist-100">
                {feature.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-mist-500">{feature.body}</p>
            </article>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
