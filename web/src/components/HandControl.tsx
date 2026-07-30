import { useEffect, useRef, useState } from 'react';
import { adaptiveEma, Frame, newSM, step, SMEvent, T } from './handTracking';

// Hands-free control: webcam → MediaPipe GestureRecognizer (100% local, the
// wasm + model are vendored in /public/mediapipe — nothing leaves the Mac)
// → gesture state machine → REAL DOM events dispatched at a ghost cursor.
// Because we synthesize genuine PointerEvent/WheelEvent/MouseEvent at
// document.elementFromPoint, every existing view works untouched: agent
// pills, approve buttons, brain rotation/zoom, ops-page scrolling.

export type HandStatus = 'off' | 'init' | 'tracking' | 'nohand' | 'error';

const FPS_INTERVAL = 1000 / 24;
const NOHAND_OFF_MS = 5 * 60 * 1000; // auto-off after 5 min without a hand
const HIDDEN_STOP_MS = 60 * 1000;    // release the camera after 60s hidden

export function HandControl({ enabled, onStatus }: {
  enabled: boolean;
  onStatus: (s: HandStatus) => void;
}) {
  const [error, setError] = useState('');
  const ghostRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!enabled) { setError(''); return; }
    let dead = false;
    let recognizer: any = null;
    let stream: MediaStream | null = null;
    let vfcId = 0;
    let rafId = 0;
    let lastRun = 0;
    let lastHandSeen = performance.now();
    let hiddenSince = 0;
    let dragTarget: Element | null = null;
    let lastStatus: HandStatus = 'init';
    const sm = newSM();
    const smooth = { x: window.innerWidth / 2, y: window.innerHeight / 2, at: performance.now() };

    const setStatus = (s: HandStatus) => {
      if (s !== lastStatus) { lastStatus = s; onStatus(s); }
    };

    const PID = 31337;
    const baseInit = (x: number, y: number, buttons: number): PointerEventInit => ({
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y,
      pointerId: PID, pointerType: 'mouse', isPrimary: true, button: 0, buttons,
    });

    const synthesize = (ev: SMEvent) => {
      switch (ev.kind) {
        case 'move':
          break; // ghost cursor render only
        case 'click': {
          const el = document.elementFromPoint(ev.x, ev.y);
          if (!el) return;
          el.dispatchEvent(new PointerEvent('pointerdown', baseInit(ev.x, ev.y, 1)));
          el.dispatchEvent(new MouseEvent('mousedown', baseInit(ev.x, ev.y, 1)));
          el.dispatchEvent(new PointerEvent('pointerup', baseInit(ev.x, ev.y, 0)));
          el.dispatchEvent(new MouseEvent('mouseup', baseInit(ev.x, ev.y, 0)));
          el.dispatchEvent(new MouseEvent('click', baseInit(ev.x, ev.y, 0)));
          // Untrusted clicks never move focus — do it for inputs/buttons.
          const f = (el as HTMLElement).closest?.('input, textarea, button, [contenteditable]');
          (f as HTMLElement | null)?.focus?.();
          break;
        }
        case 'dragStart':
          dragTarget = document.elementFromPoint(ev.x, ev.y);
          dragTarget?.dispatchEvent(new PointerEvent('pointerdown', baseInit(ev.x, ev.y, 1)));
          break;
        case 'dragMove':
          // Stream to the SAME element (pointer-capture emulation) so brain
          // drags survive the cursor leaving the original hit target.
          dragTarget?.dispatchEvent(new PointerEvent('pointermove', baseInit(ev.x, ev.y, 1)));
          break;
        case 'dragEnd':
          dragTarget?.dispatchEvent(new PointerEvent('pointerup', baseInit(ev.x, ev.y, 0)));
          dragTarget = null;
          break;
        case 'scroll': {
          const el = document.elementFromPoint(ev.x, ev.y);
          if (!el) return;
          el.dispatchEvent(new WheelEvent('wheel', { ...baseInit(ev.x, ev.y, 0), deltaY: ev.deltaY!, deltaMode: 0 }));
          // Untrusted wheel events have no default action — scroll manually.
          for (let n: Element | null = el; n; n = n.parentElement) {
            const s = getComputedStyle(n);
            if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 2) {
              n.scrollBy({ top: ev.deltaY! });
              return;
            }
          }
          document.scrollingElement?.scrollBy({ top: ev.deltaY! });
          break;
        }
      }
    };

    const digest = (res: any, now: number): Frame => {
      const lms = res?.landmarks?.[0];
      if (!lms) return { present: false, cursorX: 0, cursorY: 0, pinchRatio: 1, fist: false };
      const gest = res.gestures?.[0]?.[0];
      const fist = gest?.categoryName === 'Closed_Fist' && gest.score > 0.6;
      // Hand size reference: wrist (0) ↔ middle-finger MCP (9).
      const handSize = Math.hypot(lms[0].x - lms[9].x, lms[0].y - lms[9].y) || 1e-4;
      const pinchRatio = Math.hypot(lms[4].x - lms[8].x, lms[4].y - lms[8].y) / handSize;
      // Cursor source: index tip, or thumb-index midpoint while pinched
      // (anti-jump: closing the pinch doesn't move the cursor).
      const px = pinchRatio < T.PINCH_RELEASE ? (lms[4].x + lms[8].x) / 2 : lms[8].x;
      const py = pinchRatio < T.PINCH_RELEASE ? (lms[4].y + lms[8].y) / 2 : lms[8].y;
      // Mirror horizontally + map the camera's active region to the viewport.
      const nx = Math.max(0, Math.min(1, (T.ACTIVE_MAX - px) / (T.ACTIVE_MAX - T.ACTIVE_MIN)));
      const ny = Math.max(0, Math.min(1, (py - T.ACTIVE_MIN) / (T.ACTIVE_MAX - T.ACTIVE_MIN)));
      const rawX = nx * window.innerWidth;
      const rawY = ny * window.innerHeight;
      const dt = now - smooth.at;
      smooth.x = adaptiveEma(smooth.x, rawX, dt);
      smooth.y = adaptiveEma(smooth.y, rawY, dt);
      smooth.at = now;
      return { present: true, cursorX: smooth.x, cursorY: smooth.y, pinchRatio, fist };
    };

    const boot = async () => {
      setStatus('init');
      try {
        const mod = await import('@mediapipe/tasks-vision'); // lazy: own chunk
        const vision = await mod.FilesetResolver.forVisionTasks('/mediapipe/wasm');
        const opts = (delegate: 'GPU' | 'CPU') => ({
          baseOptions: { modelAssetPath: '/mediapipe/gesture_recognizer.task', delegate },
          runningMode: 'VIDEO' as const,
          numHands: 1,
        });
        try {
          recognizer = await mod.GestureRecognizer.createFromOptions(vision, opts('GPU'));
        } catch {
          recognizer = await mod.GestureRecognizer.createFromOptions(vision, opts('CPU'));
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
          audio: false,
        });
        if (dead) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();

        const tick = (now: number) => {
          if (dead) return;
          if (document.hidden) {
            if (!hiddenSince) hiddenSince = now;
            if (stream && now - hiddenSince > HIDDEN_STOP_MS) {
              stream.getTracks().forEach((tr) => tr.stop()); // camera LED courtesy
              stream = null;
            }
          } else {
            hiddenSince = 0;
            if (!stream) { // re-acquire after a long hide
              navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false })
                .then((st) => { if (!dead) { stream = st; video.srcObject = st; video.play(); } })
                .catch(() => { setStatus('error'); });
            } else if (now - lastRun >= FPS_INTERVAL && video.readyState >= 2) {
              lastRun = now;
              try {
                const res = recognizer.recognizeForVideo(video, now);
                const frame = digest(res, now);
                if (frame.present) {
                  lastHandSeen = now;
                  setStatus('tracking');
                } else {
                  setStatus('nohand');
                  if (now - lastHandSeen > NOHAND_OFF_MS) { setStatus('off'); return; }
                }
                for (const ev of step(sm, frame, now)) synthesize(ev);
                const g = ghostRef.current;
                if (g) {
                  g.style.transform = `translate3d(${sm.x.toFixed(1)}px, ${sm.y.toFixed(1)}px, 0)`;
                  g.dataset.mode = sm.state;
                }
              } catch { /* single bad frame — keep looping */ }
            }
          }
          const v = videoRef.current;
          if (v && 'requestVideoFrameCallback' in v && stream) {
            vfcId = (v as any).requestVideoFrameCallback(tick);
          } else {
            rafId = requestAnimationFrame(tick);
          }
        };
        rafId = requestAnimationFrame(tick);
      } catch (e: any) {
        if (dead) return;
        setError(
          e?.name === 'NotAllowedError'
            ? 'CAMERA BLOCKED — allow camera access for this site, then toggle HANDS again.'
            : `HANDS init failed: ${e?.message || e}`
        );
        setStatus('error');
      }
    };
    boot();

    return () => {
      dead = true;
      if (vfcId && videoRef.current && 'cancelVideoFrameCallback' in videoRef.current) {
        (videoRef.current as any).cancelVideoFrameCallback(vfcId);
      }
      if (rafId) cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((tr) => tr.stop());
      recognizer?.close?.();
      if (dragTarget) dragTarget.dispatchEvent(new PointerEvent('pointerup', { bubbles: true } as any));
    };
  }, [enabled, onStatus]);

  if (!enabled && !error) return null;
  return (
    <>
      <video ref={videoRef} playsInline muted
        style={{ position: 'fixed', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
      {enabled && <div className="hand-ghost" ref={ghostRef} data-mode="IDLE"><span className="hand-ghost-dot" /></div>}
      {error && (
        <div className="hand-banner">
          🖐 {error}
        </div>
      )}
    </>
  );
}
