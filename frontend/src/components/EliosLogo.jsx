/**
 * EliosLogo — logo ufficiale Elios Tech.
 * Molecola: 1 nodo centrale ambra + 5 nodi bianchi collegati con linee.
 * Testo "ELIOS TECH" (ELIOS bold, TECH regular, entrambi bianchi).
 *
 * Props:
 *  - size: altezza in px del blocco intero (default 32)
 *  - className: extra classi wrapper
 */
export default function EliosLogo({ size = 32, className = "" }) {
  const h = size;
  return (
    <div className={`inline-flex items-center gap-2 ${className}`} aria-label="Elios Tech" style={{ height: h }}>
      <svg
        viewBox="0 0 60 60"
        style={{ height: h, width: h }}
        aria-hidden
      >
        {/* Lines connecting outer nodes to center */}
        <g stroke="#e2e8f0" strokeWidth="1.3" opacity="0.95">
          <line x1="30" y1="30" x2="10" y2="14" />
          <line x1="30" y1="30" x2="50" y2="14" />
          <line x1="30" y1="30" x2="8" y2="42" />
          <line x1="30" y1="30" x2="30" y2="52" />
          <line x1="30" y1="30" x2="52" y2="42" />
        </g>
        {/* Outer nodes (white with subtle border) */}
        {[
          [10, 14], [50, 14], [8, 42], [30, 52], [52, 42],
        ].map(([cx, cy], i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r="4"
            fill="#0f172a"
            stroke="#e2e8f0"
            strokeWidth="1.8"
          />
        ))}
        {/* Center node — amber */}
        <circle cx="30" cy="30" r="4.5" fill="#facc15" stroke="#fde047" strokeWidth="1" />
      </svg>
      <span
        className="font-sans tracking-[0.02em] text-white select-none"
        style={{ fontSize: Math.round(h * 0.55), lineHeight: 1 }}
      >
        <span style={{ fontWeight: 800 }}>ELIOS</span>
        <span style={{ fontWeight: 300, marginLeft: Math.round(h * 0.12) }}>TECH</span>
      </span>
    </div>
  );
}
