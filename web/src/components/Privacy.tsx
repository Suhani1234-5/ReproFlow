import { Reveal } from './Reveal';
import { Section } from './Section';

interface Point {
  title: string;
  body: string;
  detail: string;
}

const POINTS: readonly Point[] = [
  {
    title: 'Recording stays on this device',
    body: 'Events are written straight into IndexedDB as they happen, so a service-worker restart loses nothing. Screenshots capture the visible tab and nothing else.',
    detail: 'IndexedDB · chrome.storage.local',
  },
  {
    title: 'Redaction happens before persistence',
    body: 'Password fields are never recorded, and anything shaped like a token or a card number is stripped before the write reaches the database.',
    detail: 'redact() runs on every write',
  },
  {
    title: 'Uploading is a decision, not a default',
    body: 'The GitHub token lives in chrome.storage.session and is gone when the browser closes. Issues are created only for a reproduced bug, and only when you asked for it.',
    detail: 'OAuth device flow · preview before send',
  },
];

export function Privacy() {
  return (
    <Section
      id="privacy"
      eyebrow="Privacy"
      title="Your session is evidence, not content."
      lead="ReproFlow runs on the page you are already looking at, and keeps what it collects to itself until you decide otherwise."
    >
      <div className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
        {POINTS.map((point, index) => (
          <Reveal key={point.title} delay={index * 0.08}>
            <div className="border-t border-white/10 pt-6">
              <h3 className="text-base font-medium tracking-tight text-mist-100">{point.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-mist-500">{point.body}</p>
              <span className="mt-5 block font-mono text-[0.65rem] uppercase tracking-wider text-mist-700">
                {point.detail}
              </span>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
