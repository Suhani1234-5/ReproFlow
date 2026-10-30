import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { usePrefersReducedMotion, useWebGLSupport } from '../lib/hooks';
import { Button } from './Button';
import { OrbitFallback } from './OrbitFallback';

const INTRO_KEY = 'reproflow:intro';
const INTRO_S = 2;
const SCATTER_S = 3;

const HEADLINE = ['Record once.', 'Reproduce anywhere.', 'Fix faster.'];

/** Mirrors the field's props so this file never imports the lazy chunk. */
type FieldProps = {
  progress?: number;
  speed?: number;
  spread?: number;
  colorMix?: number;
  focus?: number;
  align?: 'center' | 'right';
};

function readIntroPlayed(): boolean {
  try {
    return sessionStorage.getItem(INTRO_KEY) === '1';
  } catch {
    // Blocked storage only means the intro plays again.
    return false;
  }
}

function markIntroPlayed(): void {
  try {
    sessionStorage.setItem(INTRO_KEY, '1');
  } catch {
    // Nothing to do: the intro simply replays on the next load.
  }
}

export function Hero() {
  const reduced = usePrefersReducedMotion();
  const webgl = useWebGLSupport();

  // The scatter needs the particle field, so the intro is skipped without WebGL.
  const [playing] = useState(() => !readIntroPlayed() && !reduced && webgl);
  const [showIntro, setShowIntro] = useState(playing);
  const [count, setCount] = useState(playing ? 0 : 100);
  const [spread, setSpread] = useState(playing ? 1 : 0);
  const [Field, setField] = useState<ComponentType<FieldProps> | null>(null);
  const [fieldFailed, setFieldFailed] = useState(false);

  const rootRef = useRef<HTMLElement>(null);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!webgl || reduced) return;
    const root = rootRef.current;
    if (root === null) return;

    let alive = true;
    // three is the largest chunk on the page, so it is only fetched once the hero is close to the viewport.
    const load = (): void => {
      void import('./OrbitField').then(
        (module) => {
          if (alive) setField(() => module.default);
        },
        () => {
          if (alive) setFieldFailed(true);
        },
      );
    };

    if (typeof IntersectionObserver === 'undefined') {
      load();
      return () => {
        alive = false;
      };
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        load();
      },
      { rootMargin: '200px' },
    );
    observer.observe(root);

    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [webgl, reduced]);

  useEffect(() => {
    if (!playing) return;
    markIntroPlayed();

    let frame = 0;
    const tick = (now: number): void => {
      if (startedAtRef.current === null) startedAtRef.current = now;
      const elapsed = now - startedAtRef.current;
      if (elapsed >= INTRO_S * 1000) {
        setCount(100);
        return;
      }
      // Real signals only: the parsed document plus the 3D chunk.
      const ready = (Field !== null ? 0.6 : 0) + (document.readyState === 'complete' ? 0.4 : 0.1);
      setCount(Math.min(99, Math.round((elapsed / (INTRO_S * 1000)) * ready * 100)));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, Field]);

  useLayoutEffect(() => {
    if (!playing) return;
    const root = rootRef.current;
    if (root === null) return;

    const context = gsap.context(() => {
      // Hidden before paint: the intro reveals them in order.
      gsap.set('[data-hero-line]', { yPercent: 110 });
      gsap.set('[data-hero-tail]', { autoAlpha: 0, y: 14 });

      // 1. Particles fly in scattered, then ease into their orbits.
      const scatter = { value: 1 };
      const timeline = gsap.timeline({
        defaults: { ease: 'power3.out' },
        onComplete: () => setShowIntro(false),
      });

      timeline.to(
        scatter,
        {
          value: 0,
          duration: SCATTER_S,
          ease: 'power2.inOut',
          onUpdate: () => setSpread(Math.round(scatter.value * 100) / 100),
        },
        0,
      );

      // 2. The counter hands over to the wordmark-less hero.
      timeline.to('[data-hero-intro]', { autoAlpha: 0, duration: 0.55 }, INTRO_S);

      // 3. Headline, line by line.
      timeline.to(
        '[data-hero-line]',
        { yPercent: 0, duration: 0.9, stagger: 0.14 },
        INTRO_S + 0.15,
      );

      // 4. Buttons and the scroll hint.
      timeline.to(
        '[data-hero-tail]',
        { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.1 },
        INTRO_S + 1,
      );
    }, root);

    return () => context.revert();
  }, [playing]);

  const showField = webgl && !reduced && !fieldFailed;

  return (
    <section
      ref={rootRef}
      id="hero"
      className="relative flex min-h-screen scroll-mt-16 items-center overflow-hidden"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {showField && Field !== null ? <Field spread={spread} align="right" /> : <OrbitFallback />}
      </div>

      {/* Text scrim: the swirl owns the right of the viewport, the headline keeps a dark edge behind it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-[55%]"
        style={{ background: 'linear-gradient(to right, rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0) 100%)' }}
      />

      <div className="relative z-10 mx-auto w-full max-w-content pl-[clamp(1.5rem,5vw,5rem)]">
        <h1 className="max-w-[38ch] text-left text-[clamp(2.25rem,5vw,4.5rem)] font-semibold leading-[1.05] tracking-tight">
          {HEADLINE.map((line) => (
            <span key={line} className="block overflow-hidden pb-[0.08em]">
              <span data-hero-line className="block">
                {line}
              </span>
            </span>
          ))}
        </h1>

        <div data-hero-tail className="mt-9 flex flex-wrap items-center gap-3">
          <Button href="#install">Add to Chrome</Button>
          {/* No demo video yet: the story section is the closest thing to one. */}
          <Button href="#story" variant="ghost">
            Watch demo
          </Button>
        </div>
      </div>

      {/* Bottom scrim: the hint sits on black, never on the particles. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-40"
        style={{ background: 'linear-gradient(to top, rgba(0, 0, 0, 0.85), rgba(0, 0, 0, 0) 100%)' }}
      />

      {/* The wrapper owns the centring so GSAP stays free to own the transform on the hint. */}
      <div className="absolute inset-x-0 bottom-8 z-10 flex justify-center">
        <div data-hero-tail className="text-center">
          <span className="block text-[0.65rem] uppercase tracking-[0.35em] text-mist-500">
            Scroll
          </span>
          <span
            aria-hidden="true"
            className="mx-auto mt-3 block h-10 w-px animate-pulse bg-gradient-to-b from-white/40 to-transparent"
          />
        </div>
      </div>

      {showIntro ? (
        <div
          data-hero-intro
          aria-hidden="true"
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-8 bg-black"
        >
          <span className="text-xs uppercase tracking-[0.5em] text-mist-500">ReproFlow</span>
          <span className="font-mono text-5xl tabular-nums text-mist-100">{count}</span>
          <span className="block h-px w-44 bg-white/10">
            <span
              className="block h-px bg-accent transition-[width] duration-150 ease-linear"
              style={{ width: `${count}%` }}
            />
          </span>
        </div>
      ) : null}
    </section>
  );
}
