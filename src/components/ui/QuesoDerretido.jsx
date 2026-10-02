// Borde de "queso derretido" como el del menú impreso. Es un patrón que se
// repite a lo ancho sin deformarse.
const GOTAS = [
  // [x, ancho, largo]
  [6, 14, 18],
  [34, 10, 30],
  [58, 18, 12],
  [92, 12, 36],
  [118, 16, 20],
  [150, 10, 26],
  [176, 14, 14],
];
const BURBUJAS = [
  // agujeritos del queso [x, y, radio]
  [24, 6, 2.5],
  [80, 9, 2],
  [138, 5, 3],
  [190, 8, 2],
];

export default function QuesoDerretido({ className = "" }) {
  return (
    <svg className={`block h-14 w-full ${className}`} aria-hidden="true" focusable="false">
      <defs>
        <pattern id="queso-derretido" width="200" height="56" patternUnits="userSpaceOnUse">
          <g fill="var(--color-queso)">
            <rect x="0" y="0" width="200" height="12" />
            {Array.from({ length: 15 }, (_, i) => (
              <circle key={i} cx={i * 14 + 3} cy="12" r="6" />
            ))}
            {GOTAS.map(([x, w, l]) => (
              <g key={x}>
                <rect x={x} y="8" width={w} height={l} />
                <circle cx={x + w / 2} cy={8 + l} r={w / 2} />
              </g>
            ))}
          </g>
          <g fill="var(--color-noche)">
            {BURBUJAS.map(([x, y, r]) => (
              <circle key={x} cx={x} cy={y} r={r} />
            ))}
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#queso-derretido)" />
    </svg>
  );
}
