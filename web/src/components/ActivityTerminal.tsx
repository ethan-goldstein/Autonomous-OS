import { useEffect, useRef } from 'react';
import type { LogEntry } from '../types';

interface Props {
  logs: LogEntry[];
  title?: string;
}

export function ActivityTerminal({ logs, title = 'Live Activity Stream' }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <div className="terminal glass">
      <div className="head">
        <span className="lights">
          <span style={{ background: 'var(--red)' }} />
          <span style={{ background: 'var(--amber)' }} />
          <span style={{ background: 'var(--green)' }} />
        </span>
        {title}
      </div>
      <div className="body" ref={bodyRef}>
        {logs.length === 0 && <div className="empty">// awaiting agent activity…</div>}
        {logs.map((l, i) => (
          <div className="line" key={i}>
            <span className="t">[{new Date(l.ts).toLocaleTimeString()}]</span>{' '}
            <span className="a">{l.agentId}</span>{' '}
            <span className={`log-${l.level}`}>▸ {l.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
