import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { usePrefersReducedMotion, useWebGLSupport } from '../lib/hooks';
import { OrbitFallback } from './OrbitFallback';
import type { FieldControls, FieldControlsRef } from './OrbitField';

gsap.registerPlugin(ScrollTrigger);

/** Everything the scrub drives except the one-off pulse and flare. */
type StageValues = Omit<FieldControls, 'pulse' | 'flash'>;

interface Stage {
  id: string;
  label: string;
  title: string;
  body: string;
  values: StageValues;
}

const STAGES: readonly Stage[] = [
  {
    id: 'record',
    label: 'Record',
    title: 'Capture the bug as it happens.',
    body: 'Hit record and keep working. Clicks, typing, navigation, console errors and failed requests are logged as they happen — nothing to reproduce by hand.',
    values: {
      progress: 0.12,
      spread: 0.42,
      speed: 1.9,
      focus: 11,
      colorMix: 0.06,
      collapse: 0,
      camera: { x: 0, y: 1.4, z: 0 },
    },
  },
  {
    id: 'generate',
    label: 'Generate',
    title: 'The session becomes one Playwright spec.',
    body: 'Steps are turned into a deterministic test — role, label and test-id locators first, repeated typing collapsed into a single fill.',
    values: {
      progress: 0.55,
      spread: 0.06,
      speed: 0.7,
      focus: 8.4,
      colorMix: 0.42,
      collapse: 0,
      camera: { x: 0.2, y: 0.5, z: 0 },
    },
  },
  {
    id: 'verify',
    label: 'Verify',
    title: 'Reproduced, or it never leaves your machine.',
    body: 'The runner replays the spec three times in an isolated browser context. The failure has to be the same every run, down to the failing assertion.',
    values: {
      progress: 0.62,
      spread: 0,
      speed: 1.05,
      focus: 4.6,
      colorMix: 0.3,
      collapse: 0.85,
      camera: { x: 0, y: 1.1, z: -1.4 },
    },
  },
  {
    id: 'issue',
    label: 'File issue',
    title: 'One issue, with the evidence already attached.',
    body: 'The spec, the screenshots and the reproduction fingerprint land on a branch. The issue opens only when the bug actually reproduced.',
    values: {
      progress: 1,
      spread: 0.02,
      speed: 0.45,
      focus: 9.5,
      colorMix: 0.55,
      collapse: 0.1,
      camera: { x: 0, y: 3.1, z: 0.4 },
    },
  },
];

function initialControls(): FieldControls {
  return { ...STAGES[0].values, pulse: 0, flash: 0, camera: { ...STAGES[0].values.camera } };
}

function SpecCard() {
  return (
    <div
      aria-hidden="true"
      className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-md"
    >
      <div className="flex items-center gap-2 pb-3">
        <span className="h-2 w-2 rounded-full bg-accent" />
        <span className="font-mono text-xs text-mist-300">reproduction.spec.ts</span>
      </div>
      <pre className="overflow-x-auto rounded-xl bg-black/50 p-4 font-mono text-[0.68rem] leading-relaxed text-mist-300">
        {`test('save stays disabled', async ({ page }) => {
  await page.goto('/checkout');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
});`}
      </pre>
    </div>
  );
}

function ReproducedBadge() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-1.5 text-sm text-accent">
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      Reproduced 3/3
    </span>
  );
}

function IssueCard() {
  return (
    <div
      aria-hidden="true"
      className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-md"
    >
      <p className="text-sm font-medium text-mist-100">
        Checkout: &ldquo;Saved&rdquo; never appears after Save
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {['bug', 'reproflow', 'reproduced'].map((label) => (
          <span
            key={label}
            className="rounded-full border border-white/10 px-2.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider text-mist-300"
          >
            {label}
          </span>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/5 pt-4">
        <ReproducedBadge />
        <span className="font-mono text-[0.6rem] text-mist-500">.reproflow/8f2c1a/</span>
      </div>
    </div>
  );
}

function cardFor(id: string) {
  if (id === 'generate') return <SpecCard />;
  if (id === 'verify') {
    return (
      <div aria-hidden="true" className="flex flex-col items-start gap-3">
        <ReproducedBadge />
        <span className="text-xs text-mist-500">3 / 3 runs · same failing assertion</span>
      </div>
    );
  }
  if (id === 'issue') return <IssueCard />;
  return null;
}

function Dots({ current }: { current: number }) {
  return (
    <>
      {STAGES.map((stage, index) => (
        <span
          key={stage.id}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            index === current ? 'w-6 bg-accent' : 'w-1.5 bg-white/20'
          }`}
        />
      ))}
    </>
  );
}

export function Story() {
  const reduced = usePrefersReducedMotion();
  const webgl = useWebGLSupport();
  // Reduced motion keeps the section static: no pinning, no scrubbed uniforms.
  const animate = !reduced;

  const [stage, setStage] = useState(0);
  const [Field, setField] = useState<ComponentType<{ controls?: FieldControlsRef }> | null>(null);
  const [fieldFailed, setFieldFailed] = useState(false);

  const rootRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLSpanElement>(null);
  const controlsRef = useRef<FieldControls | null>(null);
  if (controlsRef.current === null) controlsRef.current = initialControls();

  const showField = webgl && animate && !fieldFailed;

  useEffect(() => {
    if (!showField) return;
    const root = rootRef.current;
    if (root === null) return;

    let alive = true;
    // The story is below the fold, so three is only fetched once it comes into range.
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
  }, [showField]);

  useEffect(() => {
    if (!animate) return;
    const stageElement = stageRef.current;
    const copyElement = copyRef.current;
    const controls = controlsRef.current;
    if (stageElement === null || copyElement === null || controls === null) return;

    const mm = gsap.matchMedia();

    const run = (trigger: Element, end: string, pinned: boolean): void => {
      const timeline = gsap.timeline({
        defaults: { ease: 'power2.inOut' },
        scrollTrigger: {
          trigger,
          start: pinned ? 'top top' : 'top 70%',
          end,
          pin: pinned,
          anticipatePin: 1,
          scrub: 1,
          onUpdate: (self) =>
            setStage(Math.min(STAGES.length - 1, Math.floor(self.progress * STAGES.length))),
        },
      });

      // One quarter of the scroll per stage, so the dots and the panels stay in step.
      const move = (index: number, position: number): void => {
        const { camera, ...rest } = STAGES[index].values;
        timeline.to(controls, { ...rest, duration: 1 }, position);
        timeline.to(controls.camera, { ...camera, duration: 1 }, position);
      };

      move(1, 0);
      move(2, 1);
      move(3, 2);

      // Verify: the collapse lands, then a single cyan pulse.
      timeline.to(controls, { pulse: 1, duration: 0.16, ease: 'power2.out' }, 2.34);
      timeline.to(controls, { pulse: 0, duration: 0.5, ease: 'power2.in' }, 2.52);

      // Record: a small red flare marks the bug.
      const flash = flashRef.current;
      if (flash !== null) {
        timeline.fromTo(
          flash,
          { autoAlpha: 0, scale: 0.4 },
          { autoAlpha: 1, scale: 1, duration: 0.05, ease: 'power2.out' },
          0.03,
        );
        timeline.to(flash, { autoAlpha: 0, duration: 0.45, ease: 'power2.in' }, 0.1);
      }

      // File issue: the flat disc dims while the issue card takes over.
      const canvas = canvasRef.current;
      if (canvas !== null) timeline.to(canvas, { opacity: 0.32, duration: 1 }, 3);
    };

    mm.add('(min-width: 768px)', () => run(stageElement, '+=400%', true));
    mm.add('(max-width: 767px)', () => run(copyElement, 'bottom bottom', false));

    return () => mm.revert();
  }, [animate]);

  useEffect(() => {
    if (animate) return;
    const root = rootRef.current;
    if (root === null) return;

    const context = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>('[data-story-panel]').forEach((panel, index) => {
        gsap.from(panel, {
          autoAlpha: 0,
          y: 24,
          duration: 0.6,
          ease: 'power2.out',
          scrollTrigger: { trigger: panel, start: 'top 85%' },
        });
        // The dots still follow the panel you are reading.
        ScrollTrigger.create({
          trigger: panel,
          start: 'top 60%',
          end: 'bottom 60%',
          onToggle: (self) => {
            if (self.isActive) setStage(index);
          },
        });
      });
    }, root);

    return () => context.revert();
  }, [animate]);

  return (
    <section ref={rootRef} id="story" className="relative scroll-mt-16 border-t border-white/5">
      {/* Text alternative for the particle field, which is decorative and aria-hidden. */}
      <p className="sr-only">
        Animated illustration: a field of orbiting particles starts as a wide, noisy swirl and settles
        into a single flat disc as four stages progress — record the bug, generate the spec, verify the
        failure, and file the issue. Each stage is described in order below.
      </p>

      {/* Pinned on desktop; in flow with a sticky canvas band on mobile. */}
      <div ref={stageRef} className={`relative ${animate ? 'md:h-screen' : ''}`}>
        {/* Canvas band: sticky and small on mobile, pinned full-bleed on desktop. */}
        <div
          ref={canvasRef}
          className={
            animate
              ? 'sticky top-16 z-20 h-[46vh] w-full overflow-hidden bg-black md:absolute md:inset-0 md:top-0 md:z-0 md:h-full'
              : 'relative z-10 h-[52vh] w-full overflow-hidden bg-black md:h-[62vh]'
          }
        >
          {showField && Field !== null ? (
            <Field controls={controlsRef} />
          ) : (
            <OrbitFallback />
          )}

          {animate ? (
            <div
              aria-hidden="true"
              className="absolute inset-x-0 bottom-4 z-30 flex justify-center gap-2.5 md:hidden"
            >
              <Dots current={stage} />
            </div>
          ) : null}
        </div>

        {/* Legibility scrim: the text sits over the left half of the swirl. */}
        {animate ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 z-[5] hidden w-3/5 bg-gradient-to-r from-black via-black/70 to-transparent md:block"
          />
        ) : null}

        {animate ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-[62%] top-[38%] z-30 -translate-x-1/2 -translate-y-1/2"
          >
            <span
              ref={flashRef}
              className="block h-2.5 w-2.5 rounded-full bg-red-500 opacity-0 shadow-[0_0_18px_6px_rgba(239,68,68,0.45)]"
            />
          </span>
        ) : null}

        <div ref={copyRef} className={`relative z-10 ${animate ? 'md:absolute md:inset-0' : ''}`}>
          {STAGES.map((item, index) => {
            const active = index === stage;
            const card = cardFor(item.id);
            return (
              <article
                key={item.id}
                data-story-panel
                className={
                  animate
                    ? `md:absolute md:inset-0 md:flex md:items-center md:transition-opacity md:duration-500 ${
                        active ? 'md:opacity-100' : 'md:pointer-events-none md:opacity-0'
                      }`
                    : 'py-14 md:py-20'
                }
              >
                <div className="mx-auto flex w-full max-w-content flex-col gap-8 px-6 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:items-center md:gap-12">
                  <div>
                    <span className="text-[0.65rem] uppercase tracking-[0.35em] text-accent">
                      {item.label}
                    </span>
                    <h3 className="mt-4 text-[clamp(1.5rem,3.2vw,2.4rem)] font-semibold leading-tight tracking-tight text-mist-100">
                      {item.title}
                    </h3>
                    <p className="mt-4 max-w-lg text-sm leading-relaxed text-mist-500 md:text-base">
                      {item.body}
                    </p>
                  </div>

                  <div
                    className={
                      animate
                        ? `transition duration-500 ease-out ${
                            active
                              ? 'md:translate-x-0 md:scale-100 md:opacity-100'
                              : 'md:translate-x-4 md:scale-95 md:opacity-0'
                          }`
                        : ''
                    }
                  >
                    {card}
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {animate ? (
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-6 z-20 hidden justify-center gap-2.5 md:flex md:bottom-10"
          >
            <Dots current={stage} />
          </div>
        ) : (
          <div aria-hidden="true" className="flex justify-center gap-2.5 py-10">
            <Dots current={stage} />
          </div>
        )}
      </div>
    </section>
  );
}
