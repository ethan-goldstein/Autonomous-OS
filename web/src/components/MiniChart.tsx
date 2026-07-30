interface Bar { label: string; value: number }

// Lightweight dependency-free SVG bar chart with a zero baseline (handles
// negative values — e.g. monthly net). Scales to its container width.
export function MiniChart({
  data,
  height = 150,
  format = (n) => `${n}`,
}: {
  data: Bar[];
  height?: number;
  format?: (n: number) => string;
}) {
  if (!data.length) return null;
  const vals = data.map((d) => d.value);
  const max = Math.max(...vals, 0);
  const min = Math.min(...vals, 0);
  const range = max - min || 1;
  const bw = 46;
  const W = data.length * bw;
  const pad = 22;
  const plotH = height - pad * 2;
  const zeroY = pad + (max / range) * plotH;

  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} preserveAspectRatio="xMidYMid meet" className="minichart">
      <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="rgba(120,160,255,0.25)" strokeWidth="1" />
      {data.map((d, i) => {
        const pos = d.value >= 0;
        const barH = (Math.abs(d.value) / range) * plotH;
        const x = i * bw + bw * 0.22;
        const y = pos ? zeroY - barH : zeroY;
        const w = bw * 0.56;
        return (
          <g key={i}>
            <rect x={x} y={y} width={w} height={Math.max(barH, 1)} rx="2" fill={pos ? 'var(--green)' : 'var(--red)'} opacity="0.9" />
            <text x={i * bw + bw / 2} y={pos ? y - 5 : y + barH + 12} textAnchor="middle" fontSize="9" fill="var(--text)" fontFamily="var(--mono)">
              {format(d.value)}
            </text>
            <text x={i * bw + bw / 2} y={height - 6} textAnchor="middle" fontSize="9" fill="var(--muted)" fontFamily="var(--mono)">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
