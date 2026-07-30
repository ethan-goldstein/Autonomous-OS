import { useEffect, useMemo, useRef, useState } from 'react';
import type { Agent, ApprovalEvent, LogEntry } from '../types';
import {
  buildBrain, project, seeded, hexA, satPos, SATS, SPRAY_MAX, SPRAY_LIVE,
  Cam, Projected, Vec3,
} from './brain3d';
import { AgentRoster } from './AgentRoster';

interface Props {
  agents: Agent[];
  logs: LogEntry[];
  onOpen: (view: string) => void;
  pendingApprovals?: number;
  lastApproval?: ApprovalEvent | null;
}

// Spy palette. Color is SIGNAL, not identity — agents are told apart by their
// name labels, never by hue.
const SPY_GREEN = '#2bff88'; // idle / healthy
const SPY_WHITE = '#e9f0ea'; // working
const SPY_RED = '#ff2d3f';   // error

const statusColor = (a?: Agent) =>
  a?.status === 'error' ? SPY_RED : a?.status === 'working' ? SPY_WHITE : SPY_GREEN;

// Width the telemetry rail occupies on the left; the projection center shifts
// right by half of it so no cluster hides underneath.
const RAIL_W = 250;
// Same idea on the right, where SatWatch sits above the fleet roster: 150px
// panel + 16px gutter + 16px breathing room. The two rails are balanced against
// each other, so the brain sits centered in whatever gap they leave.
const RAIL_R = 182;

// Hover sentinel for the core. Never collides with a hub index.
const CORE = -2;

/** How many times a day this agent's cron fires — its raw job size. */
function runsPerDay(cron: string | null): number {
  if (!cron) return 1.5; // chained off another agent (Agent, Agent)
  let m = /^\*\/(\d+) \* \* \* \*$/.exec(cron);
  if (m) return 1440 / Number(m[1]);              // every N minutes
  m = /^0 \*\/(\d+) \* \* \*$/.exec(cron);
  if (m) return 24 / Number(m[1]);                // every N hours
  m = /^0 ([\d,]+) \* \* \*$/.exec(cron);
  if (m) return m[1].split(',').length;           // at fixed hours
  return 1;
}
/** 0..1 job size — log-scaled so a 5-minute agent doesn't dwarf everything. */
function jobWeight(a: Agent): number {
  return Math.min(1, Math.log(runsPerDay(a.schedule) + 1) / Math.log(289));
}

// Nexus v4 — BLACK SITE. A rotatable fake-3D constellation in a flat black
// void: per-agent starburst clusters sized by how big the agent's job is, wired
// to a white core (CORE) and to each other along the fleet's real workflow
// chains, watched by orbiting satellites that paint the clusters they pass
// over. Color is signal only — green healthy, white working, red error.
// Drag to rotate (inertia + idle auto-spin), hover a cluster to flare it, click
// (or tap its label pill) to enter its ops room; click the core for CORE.

export function NexusView({ agents, logs, onOpen, pendingApprovals = 0, lastApproval = null }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState({ w: 900, h: 560 });

  const colors = useMemo(() => agents.map(statusColor), [agents]);

  // Geometry — rebuilt only when the roster (or an agent's cadence) changes.
  const idKey = agents.map((a) => `${a.id}:${a.schedule ?? '-'}`).join();
  const brain = useMemo(
    () => buildBrain(agents.map((a) => a.id), agents.map(jobWeight)),
    [idKey]
  );

  // Live state the draw loop reads without re-subscribing.
  const agentsRef = useRef(agents); agentsRef.current = agents;
  const brainRef = useRef(brain); brainRef.current = brain;
  const colorsRef = useRef(colors); colorsRef.current = colors;
  const dimsRef = useRef(dims); dimsRef.current = dims;
  const approvalsRef = useRef(pendingApprovals); approvalsRef.current = pendingApprovals;

  const camRef = useRef<Cam>({ yaw: -0.5, pitch: 0.18, vyaw: 0.0022, vpitch: 0, dist: 3.2 });
  // Deep zoom: z eases toward t every frame. 0.3 = whole galaxy far away,
  // 9 = you are INSIDE the brain swimming between particles.
  const zoomRef = useRef({ z: 1, t: 1 });
  // Free-pan lens offset in SCALE-NORMALIZED units: cx = w/2 + pan.x*scale.
  // Storing it normalized means zoom automatically dives toward the panned
  // point, and the clamp (±1.2) is constant at every depth.
  const panRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const [shiftHeld, setShiftHeld] = useState(false);
  const dragRef = useRef({ on: false, px: 0, py: 0, moved: 0 });
  const lastInteractRef = useRef(0);
  const hoverRef = useRef(-1);
  const hubScreenRef = useRef(new Float32Array(64 * 4)); // x,y,s,z per hub
  const coreScreenRef = useRef({ x: 0, y: 0, r: 30 });
  const labelRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const coreLabelRef = useRef<HTMLButtonElement>(null);
  const starsRef = useRef<{ x: number; y: number; r: number; a: number; f: number; tw: number }[]>([]);
  const meteorsRef = useRef<{ x: number; y: number; vx: number; vy: number; born: number }[]>([]);
  // Per-cluster projection scratch (x,y,s) — reused every hub, never allocated
  // in the loop. Sized to the largest cluster the builder can hand us.
  const projScratch = useRef(new Float32Array((SPRAY_MAX + SPRAY_LIVE) * 3));
  // Live activity 0..1 per agent id: bumped by every log line, decayed each
  // frame. Drives how many of the reserve particles a cluster shows.
  const activityRef = useRef<Record<string, number>>({});

  // Cluster-brain live effects: a pulse fires from an agent's cluster to the
  // core on every log line; a ring bursts at the cluster on success/error.
  const pulsesRef = useRef<{ hub: number; born: number }[]>([]);
  const ringsRef = useRef<{ hub: number; born: number; color: string }[]>([]);
  // Packets travelling a workflow link when its upstream agent hands off.
  const chainPulsesRef = useRef<{ from: number; to: number; born: number }[]>([]);
  useEffect(() => {
    const last = logs[logs.length - 1];
    if (!last) return;
    const hub = agentsRef.current.findIndex((a) => a.id === last.agentId);
    if (hub < 0) return;
    const act = activityRef.current;
    act[last.agentId] = Math.min(1, (act[last.agentId] ?? 0) + 0.34);
    const now = performance.now();
    pulsesRef.current = [...pulsesRef.current.filter((p) => now - p.born < 1500), { hub, born: now }].slice(-40);
    if (last.level === 'success' || last.level === 'error') {
      ringsRef.current = [
        ...ringsRef.current.filter((r) => now - r.born < 1200),
        { hub, born: now, color: last.level === 'error' ? SPY_RED : SPY_GREEN },
      ].slice(-12);
    }
    // An upstream chain agent finishing is the handoff — send a packet down the
    // link so the workflow edge visibly carries data, not just decoration.
    if (last.level === 'success') {
      const lk = brainRef.current.links;
      for (let i = 0; i < lk.length; i += 2) {
        if (lk[i] !== hub) continue;
        chainPulsesRef.current = [
          ...chainPulsesRef.current.filter((p) => now - p.born < 2200),
          { from: lk[i], to: lk[i + 1], born: now },
        ].slice(-8);
      }
    }
  }, [logs]);

  // Shift affordance: FREE PAN mode indicator + cursor. Window-level so it
  // works before the first click; cleared on blur (Cmd-Tab sticky-shift bug).
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(false); };
    const blur = () => setShiftHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Track size.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDims({ w: Math.max(320, width), h: Math.max(420, height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Scatter three parallax star layers whenever size changes. There is no
  // backdrop image any more — the void is flat black, and these stars are the
  // only thing in it.
  useEffect(() => {
    const { w, h } = dims;

    // Parallax stars: f = drift px per radian of yaw (bigger = nearer layer).
    const stars: { x: number; y: number; r: number; a: number; f: number; tw: number }[] = [];
    const mk = (n: number, f: number, rMin: number, rMax: number, aMax: number, seedBase: number) => {
      for (let i = 0; i < n; i++) {
        stars.push({
          x: seeded(seedBase + i * 7 + 1) * w,
          y: seeded(seedBase + i * 7 + 2) * h,
          r: rMin + seeded(seedBase + i * 7 + 3) * (rMax - rMin),
          a: 0.1 + seeded(seedBase + i * 7 + 4) * aMax,
          f,
          tw: seeded(seedBase + i * 7 + 5) * 6.28,
        });
      }
    };
    mk(140, 26, 0.4, 0.9, 0.35, 100);   // far dust
    mk(90, 70, 0.6, 1.3, 0.5, 4000);    // mid field
    mk(45, 150, 0.9, 1.9, 0.65, 9000);  // near, sweeps on rotation
    starsRef.current = stars;
  }, [dims]);

  // ── The render loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf = 0;
    const P: Projected = { x: 0, y: 0, s: 0, z: 0 };
    const SP: Vec3 = { x: 0, y: 0, z: 0 };
    const satScreen = new Float32Array(SATS.length * 4); // x,y,s,z per sat
    const satDir = new Float32Array(SATS.length * 3);    // unit direction per sat

    const draw = (now: number) => {
      const t = now / 1000;
      const { w, h } = dimsRef.current;
      const cam = camRef.current;
      const b = brainRef.current;
      const ags = agentsRef.current;
      const cols = colorsRef.current;
      const act = activityRef.current;
      // Ease the zoom toward its target — buttery scroll-dive.
      const zoom = zoomRef.current;
      zoom.z += (zoom.t - zoom.z) * 0.12;
      const scale = Math.min(w, h) * 0.42 * zoom.z;
      // Free-pan lens: ease toward target, then shift the projection center.
      const pan = panRef.current;
      pan.x += (pan.tx - pan.x) * 0.12;
      pan.y += (pan.ty - pan.y) * 0.12;
      // Balance the two instrument rails so neither covers a cluster. Each uses
      // its own breakpoint: the telemetry rail hides at 900, SatWatch and the
      // fleet roster hide at 760. cx is computed once and used by projection,
      // hit-testing and label sync alike, so the offset stays consistent.
      const railL = w > 900 ? RAIL_W : 0;
      const railR = w > 760 ? RAIL_R : 0;
      const cx = w / 2 + (railL - railR) / 2 + pan.x * scale;
      const cy = h / 2 + pan.y * scale;
      const sizeBoost = 0.7 + 0.4 * Math.sqrt(zoom.z); // particles grow as you dive
      const inside = Math.max(0, Math.min(1, (zoom.z - 1.8) / 2)); // 0→1 as you enter the brain

      // Decay every agent's activity a little each frame (~26%/second).
      for (const k in act) {
        act[k] *= 0.995;
        if (act[k] < 0.002) delete act[k];
      }

      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr; canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Camera: integrate velocity; friction while free; idle auto-spin.
      if (!dragRef.current.on) {
        cam.yaw += cam.vyaw;
        cam.pitch = Math.max(-1.2, Math.min(1.2, cam.pitch + cam.vpitch));
        cam.vyaw *= 0.94; cam.vpitch *= 0.94;
        if (now - lastInteractRef.current > 3000) {
          cam.vyaw += (0.0022 - cam.vyaw) * 0.02; // ease back into auto-spin
        }
      }

      // Black void + three parallax star layers that drift against the rotation
      // (wrap-around, so spinning feels like real motion).
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      for (const s of starsRef.current) {
        const px = (((s.x - cam.yaw * s.f) % w) + w) % w;
        const py = (((s.y + cam.pitch * s.f * 0.7) % h) + h) % h;
        const tw = 0.65 + 0.35 * Math.sin(t * 1.7 + s.tw);
        ctx.globalAlpha = s.a * tw * 0.75;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(px, py, s.r, 0, 6.28);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Shooting star every few seconds — because why not.
      if (Math.random() < 0.006 && meteorsRef.current.length < 2) {
        const fromLeft = Math.random() < 0.5;
        meteorsRef.current.push({
          x: fromLeft ? -20 : w * (0.3 + Math.random() * 0.7),
          y: h * 0.05 + Math.random() * h * 0.25,
          vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 5),
          vy: 2.2 + Math.random() * 2,
          born: now,
        });
      }
      ctx.globalCompositeOperation = 'lighter';
      meteorsRef.current = meteorsRef.current.filter((m) => now - m.born < 1600 && m.x > -80 && m.x < w + 80 && m.y < h + 40);
      for (const m of meteorsRef.current) {
        m.x += m.vx; m.y += m.vy;
        const fade = 1 - (now - m.born) / 1600;
        const grad = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 9, m.y - m.vy * 9);
        grad.addColorStop(0, `rgba(255,255,255,${0.8 * fade})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(m.x - m.vx * 9, m.y - m.vy * 9);
        ctx.stroke();
      }

      const wireMul = 1 - inside * 0.85;

      // Ambient dust — flat arcs only (no gradients: perf rule). Brightens as
      // you dive in so the interior feels alive, not empty.
      for (let i = 0; i * 3 < b.ambient.length; i++) {
        project(b.ambient[i * 3], b.ambient[i * 3 + 1], b.ambient[i * 3 + 2], cam, cx, cy, scale, P);
        const tw = 0.6 + 0.4 * Math.sin(t * 1.3 + i);
        ctx.globalAlpha = Math.min(0.5, (0.03 + 0.1 * P.s * P.s) * tw + inside * 0.06);
        ctx.fillStyle = '#c8d4cc';
        ctx.beginPath();
        ctx.arc(P.x, P.y, (0.4 + 0.9 * P.s) * sizeBoost, 0, 6.28);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Clusters: one projection pass into scratch, then glowing spokes
      // (batched two-pass path) + spray dots + the hub sprite.
      const hs = hubScreenRef.current;
      const sc = projScratch.current;
      for (let hub = 0; hub < b.nHubs; hub++) {
        const ag = ags[hub];
        const col = ag?.status === 'error' ? '#ff5d73' : cols[hub] || '#38f5a8';
        const hot = ag ? (act[ag.id] ?? 0) : 0;
        const active = hoverRef.current === hub || ag?.status === 'working' || hot > 0.25;
        // Cluster size IS the job size; live activity spends the reserve.
        const start = b.sprayStart[hub];
        let count = Math.min(b.sprayCap[hub], b.sprayBase[hub] + Math.round(hot * SPRAY_LIVE));
        if (zoom.z < 0.7) count >>= 1; // LOD: galaxy-in-your-palm, halve the dust

        project(b.hubs[hub * 3], b.hubs[hub * 3 + 1], b.hubs[hub * 3 + 2], cam, cx, cy, scale, P);
        const hx = P.x, hy = P.y, hss = P.s, hz = P.z;
        hs[hub * 4] = hx; hs[hub * 4 + 1] = hy; hs[hub * 4 + 2] = hss; hs[hub * 4 + 3] = hz;

        // Project once, cache, and build the spoke path in the same pass — the
        // old code projected every particle twice (once for the spoke, once for
        // the dot), which is what pays for the much bigger clusters.
        ctx.beginPath();
        for (let k = 0; k < count; k++) {
          const s = start + k;
          project(b.spray[s * 3], b.spray[s * 3 + 1], b.spray[s * 3 + 2], cam, cx, cy, scale, P);
          sc[k * 3] = P.x; sc[k * 3 + 1] = P.y; sc[k * 3 + 2] = P.s;
          ctx.moveTo(hx, hy);
          ctx.lineTo(P.x, P.y);
        }
        // Glow: wide + faint halo under a thin + bright line. The composite is
        // already 'lighter', so the two passes add into a real glow. shadowBlur
        // would be a gaussian per stroke — 25 of them a frame kills the budget.
        ctx.strokeStyle = hexA(col, active ? 0.05 : 0.018);
        ctx.lineWidth = 3.2;
        ctx.stroke();
        ctx.strokeStyle = hexA(col, active ? 0.2 : 0.075);
        ctx.lineWidth = 0.6;
        ctx.stroke();

        // Spray particles with twinkle (drawn from the cached projections).
        ctx.fillStyle = col;
        for (let k = 0; k < count; k++) {
          const s = start + k;
          const ps = sc[k * 3 + 2];
          const tw = 0.55 + 0.45 * Math.sin(t * 2 + b.sprayLen[s] * 7 + k);
          ctx.globalAlpha = Math.min(1, (0.2 + 0.5 * ps * ps) * tw * (active ? 1.8 : 1));
          ctx.beginPath();
          ctx.arc(sc[k * 3], sc[k * 3 + 1], (0.5 + 1.3 * ps) * sizeBoost * (active ? 1.25 : 1), 0, 6.28);
          ctx.fill();
        }
        ctx.globalAlpha = 1;

        // Hub sprite (gradient — one of the few allowed per frame).
        const hr = (5 + 7 * hss) * sizeBoost * (active ? 1.4 : 1);
        const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr * 2.4);
        hg.addColorStop(0, hexA(col, 0.9));
        hg.addColorStop(0.4, hexA(col, 0.35));
        hg.addColorStop(1, hexA(col, 0));
        ctx.fillStyle = hg;
        ctx.beginPath(); ctx.arc(hx, hy, hr * 2.4, 0, 6.28); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath(); ctx.arc(hx, hy, Math.max(1.2, hr * 0.22), 0, 6.28); ctx.fill();
      }

      // ── WORKFLOW WIRING ───────────────────────────────────────────────────
      // Faint spokes to the hub show reporting lines; the two real chains from
      // registry.js get bright marching links that carry packets on handoff.
      project(0, 0, 0, cam, cx, cy, scale, P);
      const hubX = P.x, hubY = P.y;

      ctx.beginPath();
      for (let hub = 0; hub < b.nHubs; hub++) {
        ctx.moveTo(hs[hub * 4], hs[hub * 4 + 1]);
        ctx.lineTo(hubX, hubY);
      }
      ctx.strokeStyle = 'rgba(233,240,234,0.055)';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      const lk = b.links;
      ctx.setLineDash([5, 6]);
      ctx.lineDashOffset = -t * 22; // marching ants = live signal
      for (let i = 0; i < lk.length; i += 2) {
        const a = lk[i], z = lk[i + 1];
        const live = ags[a]?.status === 'working' || ags[z]?.status === 'working';
        const col = live ? SPY_WHITE : SPY_GREEN;
        ctx.beginPath();
        ctx.moveTo(hs[a * 4], hs[a * 4 + 1]);
        ctx.lineTo(hs[z * 4], hs[z * 4 + 1]);
        ctx.strokeStyle = hexA(col, live ? 0.1 : 0.05);
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.strokeStyle = hexA(col, live ? 0.55 : 0.28);
        ctx.lineWidth = 0.9;
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;

      // Packets in transit along a link.
      const nowP = performance.now();
      chainPulsesRef.current = chainPulsesRef.current.filter((p) => nowP - p.born < 2200);
      for (const p of chainPulsesRef.current) {
        if (p.from >= b.nHubs || p.to >= b.nHubs) continue;
        const prog = Math.min(1, (nowP - p.born) / 1400);
        const eased = prog * prog * (3 - 2 * prog);
        // Interpolate in MODEL space so the packet follows the 3D edge.
        const px3 = b.hubs[p.from * 3] + (b.hubs[p.to * 3] - b.hubs[p.from * 3]) * eased;
        const py3 = b.hubs[p.from * 3 + 1] + (b.hubs[p.to * 3 + 1] - b.hubs[p.from * 3 + 1]) * eased;
        const pz3 = b.hubs[p.from * 3 + 2] + (b.hubs[p.to * 3 + 2] - b.hubs[p.from * 3 + 2]) * eased;
        project(px3, py3, pz3, cam, cx, cy, scale, P);
        const fade = 1 - Math.max(0, (nowP - p.born - 1400) / 800);
        ctx.fillStyle = hexA(SPY_WHITE, 0.95 * fade);
        ctx.beginPath(); ctx.arc(P.x, P.y, 2.2 * (0.6 + P.s), 0, 6.28); ctx.fill();
      }

      // ── SATELLITE DETECTOR ────────────────────────────────────────────────
      // Four birds on tilted orbits + a rotating radar sweep. When a bird
      // passes over an agent cluster it paints it: scan line, lock-on
      // brackets, and a tracking tag. This is the surveillance layer.
      const alert = approvalsRef.current > 0;
      const satFade = 1 - inside * 0.7; // fades out once you're inside the brain

      // Orbit tracks.
      ctx.setLineDash([2, 7]);
      for (const ring of b.orbits) {
        ctx.beginPath();
        let backAvg = 0;
        for (let i = 0; i * 3 < ring.length; i++) {
          project(ring[i * 3], ring[i * 3 + 1], ring[i * 3 + 2], cam, cx, cy, scale, P);
          backAvg += P.z;
          if (i === 0) ctx.moveTo(P.x, P.y); else ctx.lineTo(P.x, P.y);
        }
        backAvg /= ring.length / 3;
        const a = (backAvg > 0 ? 0.025 : 0.055) * satFade;
        ctx.strokeStyle = `rgba(233,240,234,${a})`;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Radar sweep — screen-space, centered on the globe and scaled with it,
      // so it always reads as a rotating beam. (A 3D sweep plane collapses to
      // a thin lens whenever it turns edge-on to the camera.) Alert state
      // recolors it amber and spins it faster.
      const rcx = hubX, rcy = hubY;
      const RR = scale * 1.55;
      const tint = alert ? '255,45,63' : '43,255,136';
      const sweep = (t / (5.2 * (alert ? 0.62 : 1))) * Math.PI * 2;
      ctx.save();
      ctx.translate(rcx, rcy);
      // Trailing afterglow: 8 flat wedges, decaying. No gradient per slice.
      for (let s = 0; s < 8; s++) {
        ctx.fillStyle = `rgba(${tint},${0.03 * (1 - s / 8) * satFade})`;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, RR, sweep - (s + 1) * 0.115, sweep - s * 0.115);
        ctx.fill();
      }
      // Leading edge — the one gradient in this block.
      const lg = ctx.createLinearGradient(0, 0, Math.cos(sweep) * RR, Math.sin(sweep) * RR);
      lg.addColorStop(0, `rgba(${tint},0)`);
      lg.addColorStop(1, `rgba(${tint},${0.5 * satFade})`);
      ctx.strokeStyle = lg;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(sweep) * RR, Math.sin(sweep) * RR);
      ctx.stroke();
      // Range rings.
      ctx.strokeStyle = `rgba(${tint},${0.07 * satFade})`;
      ctx.lineWidth = 0.5;
      for (const f of [0.42, 0.72, 1]) {
        ctx.beginPath(); ctx.arc(0, 0, RR * f, 0, 6.28); ctx.stroke();
      }
      ctx.restore();

      // Satellite bodies.
      for (let i = 0; i < SATS.length; i++) {
        satPos(SATS[i], t, SP);
        const dl = Math.hypot(SP.x, SP.y, SP.z) || 1;
        satDir[i * 3] = SP.x / dl; satDir[i * 3 + 1] = SP.y / dl; satDir[i * 3 + 2] = SP.z / dl;
        project(SP.x, SP.y, SP.z, cam, cx, cy, scale, P);
        satScreen[i * 4] = P.x; satScreen[i * 4 + 1] = P.y;
        satScreen[i * 4 + 2] = P.s; satScreen[i * 4 + 3] = P.z;
        const behind = P.z > 0;
        const a = (behind ? 0.35 : 1) * satFade;
        const r = (2.6 + 2.4 * P.s) * sizeBoost;
        if (!behind) {
          const sg = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, r * 4);
          sg.addColorStop(0, `rgba(233,240,234,${0.5 * satFade})`);
          sg.addColorStop(1, 'rgba(233,240,234,0)');
          ctx.fillStyle = sg;
          ctx.beginPath(); ctx.arc(P.x, P.y, r * 4, 0, 6.28); ctx.fill();
        }
        // Body: a small diamond with stubby solar panels.
        ctx.save();
        ctx.translate(P.x, P.y);
        ctx.rotate(t * 0.8 + i);
        ctx.fillStyle = `rgba(255,255,255,${0.95 * a})`;
        ctx.beginPath();
        ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = `rgba(43,255,136,${0.8 * a})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-r * 2.6, 0); ctx.lineTo(-r * 1.1, 0);
        ctx.moveTo(r * 1.1, 0); ctx.lineTo(r * 2.6, 0);
        ctx.stroke();
        ctx.restore();
      }

      // Painting: any cluster a bird is currently over gets a lock-on.
      ctx.font = '8px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textBaseline = 'middle';
      const LOCK_COS = Math.cos(0.42);
      for (let i = 0; i < SATS.length; i++) {
        for (let hub = 0; hub < b.nHubs; hub++) {
          const hxm = b.hubs[hub * 3], hym = b.hubs[hub * 3 + 1], hzm = b.hubs[hub * 3 + 2];
          const hl = Math.hypot(hxm, hym, hzm) || 1;
          const dot = (satDir[i * 3] * hxm + satDir[i * 3 + 1] * hym + satDir[i * 3 + 2] * hzm) / hl;
          if (dot < LOCK_COS) continue;
          if (hs[hub * 4 + 3] > 0.15) continue; // cluster is on the far side
          const px = hs[hub * 4], py = hs[hub * 4 + 1], ps = hs[hub * 4 + 2];
          const strength = Math.min(1, (dot - LOCK_COS) / (1 - LOCK_COS) + 0.35) * satFade;
          const pulse = 0.6 + 0.4 * Math.sin(t * 6);

          // Scan line, bird → target.
          ctx.strokeStyle = `rgba(43,255,136,${0.35 * strength * pulse})`;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(satScreen[i * 4], satScreen[i * 4 + 1]);
          ctx.lineTo(px, py);
          ctx.stroke();

          // Lock-on brackets.
          const d = 14 + 10 * ps;
          const arm = d * 0.42;
          ctx.strokeStyle = `rgba(255,45,63,${0.85 * strength})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
            ctx.moveTo(px + sx * d, py + sy * d - sy * arm);
            ctx.lineTo(px + sx * d, py + sy * d);
            ctx.lineTo(px + sx * d - sx * arm, py + sy * d);
          }
          ctx.stroke();

          // Tracking tag.
          const ag = ags[hub];
          if (ag) {
            ctx.fillStyle = `rgba(43,255,136,${0.85 * strength})`;
            ctx.fillText(`${SATS[i].id} ▸ TRK ${ag.id.toUpperCase()} · LOCK`, px + d + 5, py - d + 2);
          }
        }
      }

      // The core — CORE himself. He IS the brain: brightness and size scale
      // with how many agents are syncing, and hovering him flares the globe.
      project(0, 0, 0, cam, cx, cy, scale, P);
      const workingN = ags.filter((a) => a.status === 'working').length;
      const coreHot = hoverRef.current === CORE;
      const coreR = (26 + 6 * Math.sin(t * 1.8) + workingN * 5) * (coreHot ? 1.25 : 1);
      const cg = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, coreR * 2.6);
      cg.addColorStop(0, coreHot ? 'rgba(255,255,255,1)' : 'rgba(240,246,241,0.95)');
      cg.addColorStop(0.25, coreHot ? 'rgba(233,240,234,0.6)' : 'rgba(200,214,204,0.38)');
      cg.addColorStop(1, 'rgba(233,240,234,0)');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(P.x, P.y, coreR * 2.6, 0, 6.28); ctx.fill();
      // rotating flare cross + a slow dashed orbit ring
      ctx.save();
      ctx.translate(P.x, P.y);
      ctx.rotate(t * 0.35);
      ctx.strokeStyle = `rgba(233,240,234,${coreHot ? 0.5 : 0.28})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-coreR * 1.9, 0); ctx.lineTo(coreR * 1.9, 0);
      ctx.moveTo(0, -coreR * 1.9); ctx.lineTo(0, coreR * 1.9);
      ctx.stroke();
      ctx.rotate(-t * 0.55);
      ctx.setLineDash([3, 9]);
      ctx.strokeStyle = `rgba(255,45,63,${coreHot ? 0.8 : 0.5})`;
      ctx.beginPath();
      ctx.arc(0, 0, coreR * 1.45, 0, 6.28);
      ctx.stroke();
      if (coreHot) {
        // second, counter-rotating containment ring on hover
        ctx.rotate(t * 1.1);
        ctx.setLineDash([1, 6]);
        ctx.strokeStyle = 'rgba(255,45,63,0.6)';
        ctx.beginPath();
        ctx.arc(0, 0, coreR * 1.95, 0, 6.28);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
      coreScreenRef.current.x = P.x;
      coreScreenRef.current.y = P.y;
      coreScreenRef.current.r = coreR;

      // Live pulses: cluster → core in 3D.
      const nowMs = performance.now();
      pulsesRef.current = pulsesRef.current.filter((p) => nowMs - p.born < 1500);
      for (const p of pulsesRef.current) {
        if (p.hub >= b.nHubs) continue;
        const prog = Math.min(1, (nowMs - p.born) / 900);
        const eased = 1 - (1 - prog) * (1 - prog);
        const px3 = b.hubs[p.hub * 3] * (1 - eased);
        const py3 = b.hubs[p.hub * 3 + 1] * (1 - eased);
        const pz3 = b.hubs[p.hub * 3 + 2] * (1 - eased);
        project(px3, py3, pz3, cam, cx, cy, scale, P);
        const fade = 1 - Math.max(0, (nowMs - p.born - 900) / 600);
        const col = cols[p.hub] || SPY_GREEN;
        const pg = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, 12);
        pg.addColorStop(0, hexA(col, 0.9 * fade));
        pg.addColorStop(1, hexA(col, 0));
        ctx.fillStyle = pg;
        ctx.beginPath(); ctx.arc(P.x, P.y, 12, 0, 6.28); ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,${0.95 * fade})`;
        ctx.beginPath(); ctx.arc(P.x, P.y, 1.6, 0, 6.28); ctx.fill();
      }

      // Result bursts: expanding ring at the cluster.
      ringsRef.current = ringsRef.current.filter((r) => nowMs - r.born < 1200);
      for (const r of ringsRef.current) {
        if (r.hub >= b.nHubs) continue;
        const prog = (nowMs - r.born) / 1200;
        const rx = hs[r.hub * 4], ry = hs[r.hub * 4 + 1], rs = hs[r.hub * 4 + 2];
        ctx.strokeStyle = hexA(r.color, 0.7 * (1 - prog));
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(rx, ry, (6 + prog * 42) * rs, 0, 6.28); ctx.stroke();
      }

      ctx.globalCompositeOperation = 'source-over';

      // Edge vignette: melts the canvas into the page chrome on every side.
      const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.34, w / 2, h / 2, Math.max(w, h) * 0.72);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.72)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);

      // Sync DOM label pills — direct style mutation, zero React state.
      for (let hub = 0; hub < b.nHubs; hub++) {
        const el = labelRefs.current[hub];
        if (!el) continue;
        const x = hs[hub * 4], y = hs[hub * 4 + 1], sc2 = hs[hub * 4 + 2], z = hs[hub * 4 + 3];
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${Math.max(0.6, Math.min(1.35, sc2 * (0.8 + 0.25 * zoom.z))).toFixed(3)})`;
        const behind = z > 0.15;
        el.classList.toggle('behind', behind);
        el.classList.toggle('hovered', hoverRef.current === hub && !behind);
      }
      // CORE's caption rides under the core, and only shows on hover.
      const cl = coreLabelRef.current;
      if (cl) {
        const core = coreScreenRef.current; // P has moved on since the core drew
        cl.style.transform = `translate3d(${core.x.toFixed(1)}px, ${(core.y + core.r * 1.5 + 10).toFixed(1)}px, 0)`;
        cl.classList.toggle('on', coreHot);
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── Pointer interaction: drag-to-rotate, hover-pick, tap-to-open ──
  const onPointerDown = (e: React.PointerEvent) => {
    // try/catch: synthetic pointers (hand control) have no capturable id.
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* synthetic */ }
    dragRef.current = { on: true, px: e.clientX, py: e.clientY, moved: 0 };
    lastInteractRef.current = performance.now();
    wrapRef.current?.classList.add('dragging');
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    lastInteractRef.current = performance.now();
    if (d.on) {
      const dx = e.clientX - d.px, dy = e.clientY - d.py;
      d.px = e.clientX; d.py = e.clientY;
      d.moved += Math.abs(dx) + Math.abs(dy);
      const cam = camRef.current;
      if (e.shiftKey) {
        // ── FREE PAN: drag moves the lens instead of rotating the sphere ──
        const { w, h } = dimsRef.current;
        const scale = Math.min(w, h) * 0.42 * zoomRef.current.z;
        const pan = panRef.current;
        pan.tx = Math.max(-1.2, Math.min(1.2, pan.tx + dx / scale));
        pan.ty = Math.max(-1.2, Math.min(1.2, pan.ty + dy / scale));
        cam.vyaw = 0; cam.vpitch = 0; // no rotation inertia while panning
        return;
      }
      cam.yaw += dx * 0.005;
      cam.pitch = Math.max(-1.2, Math.min(1.2, cam.pitch + dy * 0.005));
      cam.vyaw = dx * 0.005;
      cam.vpitch = dy * 0.005;
      return;
    }
    // hover pick against last frame's projections (front hemisphere only)
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const hs = hubScreenRef.current;
    let best = -1, bestD = 1e9;
    for (let hub = 0; hub < brainRef.current.nHubs; hub++) {
      if (hs[hub * 4 + 3] > 0.15) continue; // back hemisphere
      const dx = hs[hub * 4] - mx, dy = hs[hub * 4 + 1] - my;
      const dist = Math.hypot(dx, dy);
      const rad = Math.max(18, 16 * hs[hub * 4 + 2]);
      if (dist < rad && dist < bestD) { best = hub; bestD = dist; }
    }
    // CORE's core vs a cluster: NEAREST wins. A hub on the near pole projects
    // right on top of the core, and a "core always wins" rule would make that
    // agent unclickable for part of every rotation.
    const core = coreScreenRef.current;
    const coreD = Math.hypot(core.x - mx, core.y - my);
    if (coreD < Math.max(30, core.r * 1.15) && (best < 0 || coreD < bestD)) best = CORE;
    hoverRef.current = best;
    if (wrapRef.current) wrapRef.current.style.cursor = best !== -1 ? 'pointer' : '';
  };
  const onPointerUp = () => {
    const d = dragRef.current;
    wrapRef.current?.classList.remove('dragging');
    if (d.on && d.moved < 5) {
      if (hoverRef.current === CORE) onOpen('core');
      else if (hoverRef.current >= 0) {
        const ag = agentsRef.current[hoverRef.current];
        if (ag) onOpen(ag.id);
      }
    }
    d.on = false;
  };
  // Scroll = dive. Exponential steps feel uniform at every depth; the range
  // runs from "whole galaxy in your palm" (0.3×) to "swimming between the
  // particles" (9×). The render loop eases toward the target every frame.
  const onWheel = (e: React.WheelEvent) => {
    const zoom = zoomRef.current;
    zoom.t = Math.max(0.3, Math.min(9, zoom.t * Math.exp(-e.deltaY * 0.0016)));
    // Pulling back out to overview glides the lens home automatically.
    if (zoom.t < 1.1) { panRef.current.tx = 0; panRef.current.ty = 0; }
    lastInteractRef.current = performance.now();
  };
  const recenter = () => { panRef.current.tx = 0; panRef.current.ty = 0; };

  const working = agents.filter((a) => a.status === 'working');
  const lastLog = logs[logs.length - 1];

  return (
    <div
      className={`nexus nexus-v3 ${shiftHeld ? 'freepan' : ''}`}
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onWheel={onWheel}
      onDoubleClick={recenter}
    >
      <canvas ref={canvasRef} className="nexus-canvas" style={{ width: dims.w, height: dims.h }} />

      {/* CORE IS the core globe — this caption rides under it on hover */}
      <button
        ref={coreLabelRef}
        className="nx-core-label"
        onClick={(e) => { e.stopPropagation(); onOpen('core'); }}
        onPointerDown={(e) => e.stopPropagation()}
        title="Enter the command room"
      >
        <span className="nx-core-name">core os</span>
        <span className="nx-core-sub">
          orchestrator · {working.length ? `${working.length} SYNCING` : 'STABLE'}
        </span>
      </button>

      {/* Agent label pills — positions driven per-frame by the render loop */}
      {agents.map((a, i) => (
        <button
          key={a.id}
          ref={(el) => { labelRefs.current[i] = el; }}
          className={`nexus-node status-${a.status}`}
          style={{ left: 0, top: 0, ['--c' as any]: colors[i] }}
          onClick={(e) => { e.stopPropagation(); onOpen(a.id); }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="nx-inner">
            <span className="nx-dot" />
            <span className="nx-name">{a.name}</span>
            <span className="nx-status">{a.status === 'working' ? 'working…' : a.status}</span>
          </span>
        </button>
      ))}

      {/* Right-hand fleet roster — the fast way in. Same onOpen the clusters
          use, so both routes land on the identical page. */}
      <AgentRoster agents={agents} colors={colors} onOpen={onOpen} />

      {shiftHeld && (
        <div className="nx-freepan">⌖ FREE PAN · drag to move lens · scroll dives here · dbl-click recenters</div>
      )}

      {/* Subtle live ticker bottom-left — approval events cut in when fresher */}
      <div className="nexus-ticker">
        {(() => {
          const apTs = lastApproval ? (lastApproval.item.decided_at ?? lastApproval.item.created_at) : 0;
          if (lastApproval && (!lastLog || apTs > lastLog.ts)) {
            const it = lastApproval.item;
            const verb = it.status === 'pending' ? 'queued — awaiting your tap'
              : it.status === 'auto_posted' ? 'auto-posted'
              : it.status === 'posted' ? 'posted'
              : it.status === 'rejected' ? 'rejected' : it.status;
            return `${it.agent_id ?? 'fleet'} ▸ ${it.title} — ${verb}`;
          }
          return lastLog ? `${lastLog.agentId} ▸ ${lastLog.message}` : 'NEXUS idle — drag to rotate · scroll to dive into the brain…';
        })()}
      </div>
    </div>
  );
}
