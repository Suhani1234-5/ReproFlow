import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

/**
 * Lenis owns the scroll position and ScrollTrigger reads it, so both stay in sync.
 * Reduced motion keeps native scrolling and returns a no-op cleanup.
 */
export function initSmoothScroll(): () => void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => undefined;

  const lenis = new Lenis({ duration: 1.1, anchors: true });
  lenis.on('scroll', () => ScrollTrigger.update());

  const tick = (time: number): void => {
    // GSAP's ticker reports seconds; Lenis expects milliseconds.
    lenis.raf(time * 1000);
  };

  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);

  return () => {
    gsap.ticker.remove(tick);
    lenis.destroy();
  };
}
