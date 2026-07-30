import { useEffect, useRef } from 'react';

const BOX = 150;

/**
 * Top-right satellite watch. A bird tracks a tilted orbit inside a fixed box,
 * with random WHITE flashes firing around it — short sparks at irregular
 * intervals, sometimes in bursts. Own rAF loop and its own tiny canvas; nothing
 * here touches React state, so it never re-renders the page.
 */
export function SatWatch() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = BOX * dpr;
    canvas.height = BOX * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Flashes live in polar coords around the satellite so they always sit near
    // it and can never escape the box.
    const flashes: { ang: number; dist: number; born: number; life: number; r: number }[] = [];
    let nextFlash = 0;
    let raf = 0;

    const cx = BOX / 2;
    const cy = BOX / 2 - 4;
    const RX = 52;   // orbit semi-axes
    const RY = 20;
    const TILT = -0.38;

    const draw = (now: number) => {
      const t = now / 1000;
      ctx.clearRect(0, 0, BOX, BOX);

      // Frame ticks — corner crosshairs.
      ctx.strokeStyle = 'rgba(43,255,136,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const x = cx + sx * (BOX / 2 - 6);
        const y = cy + sy * (BOX / 2 - 10);
        ctx.moveTo(x, y - sy * 7); ctx.lineTo(x, y); ctx.lineTo(x - sx * 7, y);
      }
      ctx.stroke();

      ctx.globalCompositeOperation = 'lighter';

      // Orbit track.
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(TILT);
      ctx.setLineDash([2, 5]);
      ctx.strokeStyle = 'rgba(43,255,136,0.28)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(0, 0, RX, RY, 0, 0, 6.2832);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Earth-side marker at the focus.
      ctx.fillStyle = 'rgba(43,255,136,0.22)';
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 6.28); ctx.fill();

      // Satellite position on the ellipse.
      const a = t * 0.55;
      const ex = Math.cos(a) * RX;
      const ey = Math.sin(a) * RY;
      const sx = cx + ex * Math.cos(TILT) - ey * Math.sin(TILT);
      const sy = cy + ex * Math.sin(TILT) + ey * Math.cos(TILT);
      const near = Math.sin(a) > 0; // front half of the orbit

      // Schedule flashes: irregular gaps, occasional 2-3 burst.
      if (now > nextFlash) {
        const burst = Math.random() < 0.3 ? 2 + Math.floor(Math.random() * 2) : 1;
        for (let i = 0; i < burst; i++) {
          flashes.push({
            ang: Math.random() * 6.2832,
            dist: 5 + Math.random() * 16,
            born: now + i * 70,
            life: 120 + Math.random() * 140,
            r: 1.4 + Math.random() * 2.6,
          });
        }
        nextFlash = now + 600 + Math.random() * 1900;
      }

      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i];
        const age = now - f.born;
        if (age < 0) continue;
        if (age > f.life) { flashes.splice(i, 1); continue; }
        const k = 1 - age / f.life;
        const fx = sx + Math.cos(f.ang) * f.dist;
        const fy = sy + Math.sin(f.ang) * f.dist;
        const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, f.r * 4);
        g.addColorStop(0, `rgba(255,255,255,${0.95 * k})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(fx, fy, f.r * 4, 0, 6.28); ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,${k})`;
        ctx.beginPath(); ctx.arc(fx, fy, f.r * 0.5, 0, 6.28); ctx.fill();
      }

      // The bird: diamond body + panel struts.
      const br = near ? 3.4 : 2.4;
      const alpha = near ? 1 : 0.45;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(t * 0.9);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(0, -br); ctx.lineTo(br, 0); ctx.lineTo(0, br); ctx.lineTo(-br, 0);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = `rgba(43,255,136,${0.8 * alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-br * 2.6, 0); ctx.lineTo(-br * 1.2, 0);
      ctx.moveTo(br * 1.2, 0); ctx.lineTo(br * 2.6, 0);
      ctx.stroke();
      ctx.restore();

      // Downlink beam while the bird is on the near side.
      if (near) {
        ctx.strokeStyle = `rgba(43,255,136,${0.1 + 0.1 * Math.sin(t * 5)})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(sx, sy); ctx.lineTo(cx, cy);
        ctx.stroke();
      }

      ctx.globalCompositeOperation = 'source-over';

      // Readout: azimuth + a signal bar that tracks the near/far half.
      const az = ((a * 57.2958) % 360 + 360) % 360;
      ctx.font = '8px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = 'rgba(43,255,136,0.85)';
      ctx.fillText(`SAT-07  AZ ${az.toFixed(0).padStart(3, '0')}`, 10, BOX - 20);
      ctx.fillText(near ? 'TRK' : 'ACQ', 10, BOX - 10);
      const sig = near ? 0.55 + 0.45 * Math.abs(Math.sin(a)) : 0.2;
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i / 8 < sig ? 'rgba(43,255,136,0.85)' : 'rgba(74,87,80,0.5)';
        ctx.fillRect(BOX - 12 - i * 5, BOX - 14, 3, 2 + i);
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="sat-watch">
      <div className="sw-head">
        <span>ORBITAL WATCH</span>
        <span className="sw-live">LIVE</span>
      </div>
      <canvas ref={ref} style={{ width: BOX, height: BOX }} />
    </div>
  );
}
