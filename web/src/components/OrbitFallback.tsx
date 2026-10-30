/**
 * Static stand-in for the particle field: a CSS core glow plus dotted elliptical orbits.
 * Used for prefers-reduced-motion and when WebGL is unavailable.
 */
export function OrbitFallback() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute left-1/2 top-1/2 h-[78vmin] w-[78vmin] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, rgba(34,211,238,0.20) 0%, rgba(245,247,250,0.10) 16%, rgba(136,146,166,0.07) 38%, rgba(0,0,0,0) 70%)',
        }}
      />

      <svg
        className="absolute left-1/2 top-1/2 h-[130vmin] w-[130vmin] -translate-x-1/2 -translate-y-1/2"
        viewBox="0 0 1000 1000"
        focusable="false"
      >
        <g fill="none" strokeLinecap="round" strokeDasharray="1.5 10">
          <ellipse cx="500" cy="500" rx="392" ry="126" transform="rotate(8 500 500)" stroke="#5b6474" strokeOpacity="0.30" strokeWidth="1.4" />
          <ellipse cx="500" cy="500" rx="300" ry="104" transform="rotate(-16 500 500)" stroke="#f5f7fa" strokeOpacity="0.28" strokeWidth="1.6" />
          <ellipse cx="500" cy="500" rx="232" ry="82" transform="rotate(22 500 500)" stroke="#8892a6" strokeOpacity="0.34" strokeWidth="1.4" />
          <ellipse cx="500" cy="500" rx="176" ry="58" transform="rotate(-38 500 500)" stroke="#c3cbd9" strokeOpacity="0.24" strokeWidth="1.3" />
          <ellipse cx="500" cy="500" rx="118" ry="40" transform="rotate(14 500 500)" stroke="#8892a6" strokeOpacity="0.30" strokeWidth="1.3" />
        </g>

        {/* One cyan comet head, used sparingly. */}
        <ellipse
          cx="500"
          cy="500"
          rx="232"
          ry="82"
          transform="rotate(22 500 500)"
          fill="none"
          stroke="#22d3ee"
          strokeOpacity="0.8"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="26 2000"
        />

        <circle cx="500" cy="500" r="3.5" fill="#f5f7fa" fillOpacity="0.85" />
      </svg>
    </div>
  );
}
