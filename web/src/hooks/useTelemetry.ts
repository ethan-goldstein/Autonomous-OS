import { useEffect, useState } from 'react';
import type { Telemetry } from '../types';

/**
 * Fleet telemetry for the chart rail. Polls the aggregate endpoint and refetches
 * whenever a run finishes, so a completed agent shows up in the charts at once
 * instead of waiting out the poll interval.
 *
 * Returns null until the first successful fetch — and stays null if the endpoint
 * isn't there (an older orchestrator build), which the rail renders as NO SIGNAL
 * rather than crashing.
 */
export function useTelemetry(resultTick: number) {
  const [data, setData] = useState<Telemetry | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/fleet/telemetry')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive && d) setData(d); })
        .catch(() => {});
    load();
    const poll = setInterval(load, 20000);
    return () => { alive = false; clearInterval(poll); };
  }, [resultTick]);

  return data;
}
