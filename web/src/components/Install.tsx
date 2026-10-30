import { Button } from './Button';
import { Reveal } from './Reveal';
import { Section } from './Section';

/** Static dot-orbit backdrop: dotted ellipses only, nothing animates. */
function DotOrbit() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1000 620"
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full"
    >
      <g fill="none" stroke="#8892a6" strokeOpacity="0.35" strokeDasharray="1.5 10">
        <ellipse cx="500" cy="310" rx="400" ry="150" />
        <ellipse cx="500" cy="310" rx="320" ry="215" transform="rotate(-17 500 310)" />
        <ellipse cx="500" cy="310" rx="250" ry="118" transform="rotate(23 500 310)" />
        <ellipse cx="500" cy="310" rx="170" ry="76" />
      </g>
      <g fill="#f5f7fa" fillOpacity="0.55">
        <circle cx="180" cy="310" r="1.5" />
        <circle cx="500" cy="160" r="1.5" />
        <circle cx="826" cy="336" r="1.5" />
        <circle cx="640" cy="428" r="1.5" />
        <circle cx="330" cy="246" r="1.5" />
      </g>
      <circle cx="500" cy="310" r="3" fill="#22d3ee" />
    </svg>
  );
}

export function Install() {
  return (
    <Section
      id="install"
      eyebrow="Install"
      title="Record your next bug instead of explaining it."
      lead="ReproFlow puts a record button in your toolbar. One click, and the session becomes a test you can run again."
    >
      <Reveal className="mt-14">
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02] px-6 py-14 md:px-14 md:py-20">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-60">
            <DotOrbit />
          </div>
          {/* Keeps the text readable over the orbits. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/70 to-transparent"
          />

          <div className="relative flex flex-col items-start gap-6 md:items-center md:text-center">
            <span className="rounded-full border border-white/10 px-3 py-1 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-mist-500">
              Manifest V3 · 0 host permissions
            </span>
            <p className="max-w-xl text-[clamp(1.5rem,3.4vw,2.4rem)] font-semibold leading-tight tracking-tight text-mist-100">
              Add ReproFlow, hit record, keep working.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {/* Not in the store yet, so this stays an inert button. */}
              <Button>Add to Chrome</Button>
              <Button href="#features" variant="ghost">
                See what it records
              </Button>
            </div>
            <p className="text-xs text-mist-500">
              Free and open source · your data stays local until you preview and send it.
            </p>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
