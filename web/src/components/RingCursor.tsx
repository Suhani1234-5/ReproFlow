import { useEffect, useRef, useState } from 'react';
import { usePointerFine, usePrefersReducedMotion } from '../lib/hooks';

const RING_SIZE = 34;
const LERP = 0.18;

/** Ring cursor: DOM element, lerped position, grows over links and buttons, absent on touch devices. */
export function RingCursor() {
  const active = usePointerFine() && !usePrefersReducedMotion();

  const ring = useRef<HTMLDivElement | null>(null);
  const dot = useRef<HTMLDivElement | null>(null);
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const shown = useRef(false);
  const [visible, setVisible] = useState(false);
  const [growing, setGrowing] = useState(false);

  useEffect(() => {
    if (!active) return;

    const html = document.documentElement;
    html.dataset.ringCursor = 'true';

    const onMove = (event: PointerEvent): void => {
      target.current.x = event.clientX;
      target.current.y = event.clientY;
      if (!shown.current) {
        shown.current = true;
        setVisible(true);
      }
    };

    const onOver = (event: Event): void => {
      const node = event.target;
      setGrowing(node instanceof Element && node.closest('a, button, [data-cursor="grow"]') !== null);
    };

    const onLeave = (): void => {
      shown.current = false;
      setVisible(false);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerover', onOver, true);
    document.documentElement.addEventListener('mouseleave', onLeave);

    let frame = 0;
    let running = false;
    const loop = (): void => {
      current.current.x += (target.current.x - current.current.x) * LERP;
      current.current.y += (target.current.y - current.current.y) * LERP;
      if (ring.current !== null) {
        ring.current.style.transform = `translate3d(${current.current.x}px, ${current.current.y}px, 0)`;
      }
      if (dot.current !== null) {
        dot.current.style.transform = `translate3d(${target.current.x}px, ${target.current.y}px, 0)`;
      }
      // The cursor cannot move while the tab is hidden, so the loop parks itself.
      if (running) frame = requestAnimationFrame(loop);
    };
    const start = (): void => {
      if (running) return;
      running = true;
      frame = requestAnimationFrame(loop);
    };
    const stop = (): void => {
      running = false;
      cancelAnimationFrame(frame);
    };
    const onVisibility = (): void => {
      if (document.hidden) stop();
      else start();
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerover', onOver, true);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      delete html.dataset.ringCursor;
    };
  }, [active]);

  if (!active) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none fixed left-0 top-0 z-[120]">
      <div
        ref={ring}
        className={`transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
      >
        <div
          style={{ width: RING_SIZE, height: RING_SIZE }}
          className={`-translate-x-1/2 -translate-y-1/2 rounded-full border transition-[transform,border-color] duration-200 ease-out ${
            growing ? 'scale-150 border-accent/70' : 'scale-100 border-mist-100/40'
          }`}
        />
      </div>
      <div
        ref={dot}
        className={`absolute left-0 top-0 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
      >
        <div className="-ml-[2px] -mt-[2px] h-1 w-1 rounded-full bg-accent" />
      </div>
    </div>
  );
}
