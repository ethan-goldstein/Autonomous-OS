// Dependency-free fake-3D engine for the particle brain home view.
// All geometry is built ONCE into typed arrays; the render loop only rotates,
// projects, and draws. No React, no three.js.

export interface Brain {
  hubs: Float32Array;      // nHubs × 3 — cluster centers on the sphere
  spray: Float32Array;     // total × 3 — starburst particle positions (JAGGED, see sprayStart)
  sprayLen: Float32Array;  // total — 0..1 along-spoke fraction (twinkle phase)
  sprayStart: Int32Array;  // nHubs — index of hub i's first spray particle
  sprayBase: Int32Array;   // nHubs — always-drawn count for hub i (its job size)
  sprayCap: Int32Array;    // nHubs — allocated count (base + SPRAY_LIVE headroom)
  ambient: Float32Array;   // AMBIENT × 3 — dim dust in the void
  orbits: Float32Array[];  // polylines (x,y,z)*N — one per satellite orbit
  links: Int32Array;       // pairs of hub indices — the real agent→agent chains
  nHubs: number;
}

// The workflow the server actually runs: registry.js chains Pure→Agent and
// Agent→Agent off each other's 'result'. These are the only real agent-to-agent
// edges in the fleet, so they're the only ones drawn as links.
export const CHAINS: [string, string][] = [
  ['pure', 'services'],
  ['owned', 'social'],
];

// Particle budget per cluster. The count is the agent's JOB SIZE: how often it
// actually runs. SPRAY_LIVE is headroom on top — allocated but only drawn when
// the agent is hot, so a busy cluster swells without rebuilding geometry.
export const SPRAY_MIN = 70;
export const SPRAY_MAX = 240;
export const SPRAY_LIVE = 40;
export const AMBIENT_COUNT = 1400;
const ORBIT_SEGS = 72;

/** Deterministic per-index noise (same sequence every render). */
export function seeded(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** hex (#rrggbb) + alpha → rgba() */
export function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── Satellite detector ──────────────────────────────────────────────────────
// Four birds on tilted orbits outside the cluster shell (HUB_R = 0.78). Each
// sweeps the globe and "paints" any agent cluster it passes over.
export interface Sat {
  id: string;
  inc: number;    // orbit tilt about X
  node: number;   // ascending-node rotation about Y
  r: number;      // orbit radius
  speed: number;  // rad/sec (negative = retrograde)
  phase: number;
}

export const SATS: Sat[] = [
  { id: 'SAT-01', inc: 0.42, node: 0.0, r: 1.14, speed: 0.28, phase: 0 },
  { id: 'SAT-02', inc: -0.95, node: 1.9, r: 1.28, speed: -0.19, phase: 2.1 },
  { id: 'SAT-03', inc: 1.25, node: 3.6, r: 1.06, speed: 0.34, phase: 4.4 },
  { id: 'SAT-04', inc: -0.3, node: 5.1, r: 1.4, speed: 0.14, phase: 1.2 },
];

export interface Vec3 { x: number; y: number; z: number }

/** Position of a satellite in model space at time t (seconds). */
export function satPos(s: Sat, t: number, out: Vec3): void {
  orbitPoint(s, s.phase + t * s.speed, out);
}

/** A point on the satellite's orbit circle at angle a. */
function orbitPoint(s: Sat, a: number, out: Vec3): void {
  const x0 = Math.cos(a) * s.r;
  const z0 = Math.sin(a) * s.r;
  const ci = Math.cos(s.inc), si = Math.sin(s.inc);
  const y1 = -z0 * si;
  const z1 = z0 * ci;
  const cn = Math.cos(s.node), sn = Math.sin(s.node);
  out.x = x0 * cn + z1 * sn;
  out.y = y1;
  out.z = -x0 * sn + z1 * cn;
}

/**
 * Build the whole brain for n agents. Hubs are laid out on a golden-ratio
 * spiral with |y| clamped so no cluster sits at a pole (labels stay readable).
 * `weights` is one 0..1 job-size per agent and drives the per-cluster particle
 * count; missing entries fall back to the midpoint.
 */
export function buildBrain(agentIds: string[], weights: number[] = []): Brain {
  const n = Math.max(agentIds.length, 1);
  const hubs = new Float32Array(n * 3);
  const HUB_R = 0.78;

  for (let i = 0; i < n; i++) {
    let y = 1 - (2 * (i + 0.5)) / n;      // -1..1
    y = Math.max(-0.72, Math.min(0.72, y));
    const rad = Math.sqrt(1 - y * y);
    const theta = i * 2.399963229728653;   // golden angle
    hubs[i * 3] = Math.cos(theta) * rad * HUB_R;
    hubs[i * 3 + 1] = y * HUB_R;
    hubs[i * 3 + 2] = Math.sin(theta) * rad * HUB_R;
  }

  // Jagged spray layout: cluster i owns [sprayStart[i], sprayStart[i]+sprayCap[i]).
  const sprayStart = new Int32Array(n);
  const sprayBase = new Int32Array(n);
  const sprayCap = new Int32Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.max(0, Math.min(1, weights[i] ?? 0.5));
    const base = SPRAY_MIN + Math.round(w * (SPRAY_MAX - SPRAY_MIN));
    sprayStart[i] = total;
    sprayBase[i] = base;
    sprayCap[i] = base + SPRAY_LIVE;
    total += sprayCap[i];
  }

  // Starburst spray: spokes radiating roughly outward from each hub.
  const spray = new Float32Array(total * 3);
  const sprayLen = new Float32Array(total);
  for (let i = 0; i < n; i++) {
    const hx = hubs[i * 3], hy = hubs[i * 3 + 1], hz = hubs[i * 3 + 2];
    for (let k = 0; k < sprayCap[i]; k++) {
      const s = sprayStart[i] + k;
      // random unit direction, gently biased away from the sphere center
      let dx = seeded(s * 3 + 1) * 2 - 1 + hx * 0.6;
      let dy = seeded(s * 3 + 2) * 2 - 1 + hy * 0.6;
      let dz = seeded(s * 3 + 3) * 2 - 1 + hz * 0.6;
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;
      const len = 0.06 + seeded(s * 7 + 5) * 0.24;
      spray[s * 3] = hx + dx * len;
      spray[s * 3 + 1] = hy + dy * len;
      spray[s * 3 + 2] = hz + dz * len;
      sprayLen[s] = len / 0.3;
    }
  }

  // Ambient dust filling the sphere interior.
  const ambient = new Float32Array(AMBIENT_COUNT * 3);
  for (let i = 0; i < AMBIENT_COUNT; i++) {
    let dx = seeded(i * 5 + 11) * 2 - 1;
    let dy = seeded(i * 5 + 12) * 2 - 1;
    let dz = seeded(i * 5 + 13) * 2 - 1;
    const dl = Math.hypot(dx, dy, dz) || 1;
    const r = 0.15 + seeded(i * 5 + 14) * 0.8;
    ambient[i * 3] = (dx / dl) * r;
    ambient[i * 3 + 1] = (dy / dl) * r;
    ambient[i * 3 + 2] = (dz / dl) * r;
  }

  // Workflow edges: resolve the chain ids to hub indices, dropping any pair
  // whose endpoints aren't both in the current roster.
  const pairs: number[] = [];
  for (const [from, to] of CHAINS) {
    const a = agentIds.indexOf(from);
    const b = agentIds.indexOf(to);
    if (a >= 0 && b >= 0) pairs.push(a, b);
  }
  const links = Int32Array.from(pairs);

  // Satellite orbit tracks — same math as satPos, baked as polylines.
  const orbits: Float32Array[] = [];
  const p: Vec3 = { x: 0, y: 0, z: 0 };
  for (const sat of SATS) {
    const ring = new Float32Array((ORBIT_SEGS + 1) * 3);
    for (let s = 0; s <= ORBIT_SEGS; s++) {
      orbitPoint(sat, (s / ORBIT_SEGS) * Math.PI * 2, p);
      ring[s * 3] = p.x; ring[s * 3 + 1] = p.y; ring[s * 3 + 2] = p.z;
    }
    orbits.push(ring);
  }

  return { hubs, spray, sprayLen, sprayStart, sprayBase, sprayCap, ambient, orbits, links, nHubs: n };
}

export interface Cam {
  yaw: number;
  pitch: number;
  vyaw: number;
  vpitch: number;
  dist: number;
}

const FOV = 2.4;

export interface Projected { x: number; y: number; s: number; z: number }

/**
 * Rotate (yaw around Y, then pitch around X) + perspective-project.
 * cx/cy is the projection center — the free-pan lens moves it around, which
 * is also what makes zoom dive toward wherever the lens sits.
 * out.s ≈ 1 at sphere center depth; out.z = rotated depth (positive = away).
 */
export function project(
  x: number, y: number, z: number,
  cam: Cam, cx: number, cyc: number, scale: number,
  out: Projected
): void {
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const xr = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const yr = y * cp - z1 * sp;
  const zr = y * sp + z1 * cp;
  const persp = (FOV + cam.dist - 1) / (FOV + cam.dist + zr);
  out.x = cx + xr * persp * scale;
  out.y = cyc + yr * persp * scale;
  out.s = persp;
  out.z = zr;
}
