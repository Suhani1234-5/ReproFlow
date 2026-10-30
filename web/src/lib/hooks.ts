import { useEffect, useState } from 'react';

/** Media query hook that stays correct when the user changes the setting. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (): void => setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

export function usePointerFine(): boolean {
  return useMediaQuery('(hover: hover) and (pointer: fine)');
}

let webglCache: boolean | undefined;

/** Probed once per session: the hero swaps to the CSS poster when WebGL is unavailable. */
function probeWebGL(): boolean {
  if (webglCache !== undefined) return webglCache;
  try {
    const canvas = document.createElement('canvas');
    webglCache = Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    webglCache = false;
  }
  return webglCache;
}

export function useWebGLSupport(): boolean {
  const [supported] = useState(probeWebGL);
  return supported;
}
