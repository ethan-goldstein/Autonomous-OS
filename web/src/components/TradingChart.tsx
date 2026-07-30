interface Pt { label: string; value: number }

// Day-trading-style line chart: segments turn GREEN when the value rises and
// RED when it falls, with a glowing line, faint grid, and a zero baseline.
export function TradingChart({
  data,
  height = 180,
  format = (n) => `${n}`,
}: {
  data: Pt[];
  height?: number;
  format?: (n: number) => string;
}) {
  if (!data.length) return null;
  const vals = data.map((d) => d.value);
  let max = Math.max(...vals);
  let min = Math.min(...vals);
  if (max === min) { max += 1; min -= 1; }
  const span = max - min;
  max += span * 0.18; min -= span * 0.18; // headroom
  const range = max - min || 1;

  const padX = 46, padTop = 16, padBot = 26;
  const stepX = data.length > 1 ? 560 / (data.length - 1) : 0;
  const innerW = stepX * (data.length - 1);
  const W = padX * 2 + innerW;
  const plotH = height - padTop - padBot;
  const x = (i: number) => padX + i * stepX;
  const y = (v: number) => padTop + ((max - v) / range) * plotH;
  const pts = data.map((d, i) => [x(i), y(d.value)] as [number, number]);
  const zeroIn = min <= 0 && max >= 0;
  const zeroY = y(0);
  const uptrend = data[data.length - 1].value >= data[0].value;
  const trendColor = uptrend ? 'var(--green)' : 'var(--red)';

  const gridY = [0.0, 0.5, 1.0].map((f) => padTop + f * plotH);

  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} preserveAspectRatio="xMidYMid meet" className="tchart">
      <defs>
        <filter id="tglow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <linearGradient id="tarea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={uptrend ? 'rgba(56,245,168,0.28)' : 'rgba(255,93,115,0.28)'} />
          <stop offset="1" stopColor="rgba(56,245,168,0)" />
        </linearGradient>
      </defs>

      {/* grid */}
      {gridY.map((gy, i) => <line key={i} x1={padX} y1={gy} x2={W - padX} y2={gy} stroke="rgba(120,160,255,0.10)" strokeWidth="1" />)}
      {/* zero baseline */}
      {zeroIn && <line x1={padX} y1={zeroY} x2={W - padX} y2={zeroY} stroke="rgba(120,160,255,0.35)" strokeWidth="1" strokeDasharray="4 4" />}

      {/* area fill under the line */}
      {pts.length > 1 && (
        <path
          d={`M ${pts[0][0]} ${zeroIn ? zeroY : padTop + plotH} ` + pts.map((p) => `L ${p[0]} ${p[1]}`).join(' ') + ` L ${pts[pts.length - 1][0]} ${zeroIn ? zeroY : padTop + plotH} Z`}
          fill="url(#tarea)"
        />
      )}

      {/* colored segments: green up, red down */}
      {pts.slice(1).map((p, i) => {
        const prev = pts[i];
        const rising = data[i + 1].value >= data[i].value;
        return <line key={i} x1={prev[0]} y1={prev[1]} x2={p[0]} y2={p[1]} stroke={rising ? 'var(--green)' : 'var(--red)'} strokeWidth="2.5" filter="url(#tglow)" strokeLinecap="round" />;
      })}

      {/* points + labels */}
      {pts.map((p, i) => {
        const rising = i === 0 ? data[0].value >= 0 : data[i].value >= data[i - 1].value;
        const col = i === 0 ? trendColor : rising ? 'var(--green)' : 'var(--red)';
        return (
          <g key={i}>
            <circle cx={p[0]} cy={p[1]} r="3.5" fill={col} filter="url(#tglow)" />
            <text x={p[0]} y={p[1] - 9} textAnchor="middle" fontSize="9.5" fill="var(--text)" fontFamily="var(--mono)">{format(data[i].value)}</text>
            <text x={p[0]} y={height - 7} textAnchor="middle" fontSize="9.5" fill="var(--muted)" fontFamily="var(--mono)">{data[i].label}</text>
          </g>
        );
      })}
    </svg>
  );
}
