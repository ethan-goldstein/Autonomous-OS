// Pure gesture logic for hands-free control — no DOM, no MediaPipe imports.
// HandControl.tsx digests recognizer results into a Frame, feeds step(), and
// synthesizes real DOM events from the returned SMEvents.

export type HandState = 'IDLE' | 'CURSOR' | 'PINCH_PENDING' | 'DRAGGING' | 'SCROLLING';

// Every tunable in one place.
export const T = {
  PINCH_ENGAGE: 0.3,   // d(tip4,tip8) / hand size — hysteresis pair
  PINCH_RELEASE: 0.42,
  CLICK_MAX_MS: 350,   // pinch shorter than this + little travel = click
  CLICK_MAX_PX: 24,
  FIST_FRAMES: 3,      // consecutive frames to enter/exit SCROLLING
  SCROLL_GAIN: 3.2,    // wheel deltaY px per px of fist vertical travel
  ABSENT_FRAMES: 5,    // frames without a hand before dropping to IDLE
  ACTIVE_MIN: 0.12,    // camera-space active region → full viewport
  ACTIVE_MAX: 0.88,
};

/** Adaptive EMA (poor man's 1-Euro): steady hand = heavy smoothing,
 *  fast hand = light smoothing, so there's no jitter AND no lag. */
export function adaptiveEma(prev: number, raw: number, dtMs: number): number {
  const speed = Math.abs(raw - prev) / Math.max(dtMs, 1); // px/ms
  const a = Math.min(0.65, 0.18 + speed * 0.9);
  return prev + (raw - prev) * a;
}

export interface Frame {
  present: boolean;
  cursorX: number;   // viewport px, already mirrored + mapped + smoothed
  cursorY: number;
  pinchRatio: number;
  fist: boolean;
}

export interface SMEvent {
  kind: 'move' | 'click' | 'dragStart' | 'dragMove' | 'dragEnd' | 'scroll';
  x: number;
  y: number;
  deltaY?: number;
}

export interface SM {
  state: HandState;
  x: number;
  y: number;
  pinchDownAt: number;
  pinchDownX: number;
  pinchDownY: number;
  fistStreak: number;
  noFistStreak: number;
  absentStreak: number;
  lastY: number;
}

export function newSM(): SM {
  return {
    state: 'IDLE', x: -100, y: -100,
    pinchDownAt: 0, pinchDownX: 0, pinchDownY: 0,
    fistStreak: 0, noFistStreak: 0, absentStreak: 0, lastY: 0,
  };
}

/** Advance the state machine one frame; returns DOM events to synthesize. */
export function step(sm: SM, f: Frame, now: number): SMEvent[] {
  const out: SMEvent[] = [];

  if (!f.present) {
    sm.absentStreak += 1;
    if (sm.absentStreak >= T.ABSENT_FRAMES && sm.state !== 'IDLE') {
      if (sm.state === 'DRAGGING') out.push({ kind: 'dragEnd', x: sm.x, y: sm.y });
      sm.state = 'IDLE';
    }
    return out;
  }
  sm.absentStreak = 0;

  // Track fist streaks with hysteresis on both edges.
  if (f.fist) { sm.fistStreak += 1; sm.noFistStreak = 0; }
  else { sm.noFistStreak += 1; sm.fistStreak = 0; }

  const pinched = f.pinchRatio < T.PINCH_ENGAGE;
  const released = f.pinchRatio > T.PINCH_RELEASE;

  switch (sm.state) {
    case 'IDLE':
      sm.state = 'CURSOR';
      sm.x = f.cursorX; sm.y = f.cursorY;
      out.push({ kind: 'move', x: sm.x, y: sm.y });
      break;

    case 'CURSOR':
      sm.x = f.cursorX; sm.y = f.cursorY;
      out.push({ kind: 'move', x: sm.x, y: sm.y });
      if (pinched) {
        sm.state = 'PINCH_PENDING';
        sm.pinchDownAt = now;
        sm.pinchDownX = sm.x; sm.pinchDownY = sm.y; // click anchors here
      } else if (sm.fistStreak >= T.FIST_FRAMES) {
        sm.state = 'SCROLLING';
        sm.lastY = f.cursorY;
      }
      break;

    case 'PINCH_PENDING': {
      const travel = Math.hypot(f.cursorX - sm.pinchDownX, f.cursorY - sm.pinchDownY);
      if (released) {
        // Quick pinch = click (at the engage position — no release jump).
        if (now - sm.pinchDownAt <= T.CLICK_MAX_MS && travel <= T.CLICK_MAX_PX) {
          out.push({ kind: 'click', x: sm.pinchDownX, y: sm.pinchDownY });
        }
        sm.state = 'CURSOR';
      } else if (travel > T.CLICK_MAX_PX || now - sm.pinchDownAt > T.CLICK_MAX_MS) {
        sm.state = 'DRAGGING';
        out.push({ kind: 'dragStart', x: sm.pinchDownX, y: sm.pinchDownY });
      }
      break;
    }

    case 'DRAGGING':
      sm.x = f.cursorX; sm.y = f.cursorY;
      if (released) {
        sm.state = 'CURSOR';
        out.push({ kind: 'dragEnd', x: sm.x, y: sm.y });
      } else {
        out.push({ kind: 'dragMove', x: sm.x, y: sm.y });
      }
      break;

    case 'SCROLLING': {
      const dy = sm.lastY - f.cursorY; // fist up = positive dy
      sm.lastY = f.cursorY;
      sm.x = f.cursorX; sm.y = f.cursorY;
      if (Math.abs(dy) > 0.5) {
        out.push({ kind: 'scroll', x: sm.x, y: sm.y, deltaY: -dy * T.SCROLL_GAIN });
      }
      if (sm.noFistStreak >= T.FIST_FRAMES) sm.state = 'CURSOR';
      break;
    }
  }
  return out;
}
