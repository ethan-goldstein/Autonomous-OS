/**
 * Public demo only. Makes it unmistakable that this is seeded data and that no
 * action taken here reaches the outside world.
 */
export function DemoBanner() {
  return (
    <div
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999,
        display: 'flex', gap: '0.75rem', alignItems: 'center', justifyContent: 'center',
        flexWrap: 'wrap', padding: '7px 14px',
        background: 'rgba(6,10,14,0.94)', borderTop: '1px solid rgba(61,240,255,0.35)',
        backdropFilter: 'blur(6px)',
        font: "11px/1.5 'Share Tech Mono', ui-monospace, monospace",
        letterSpacing: '0.08em', color: '#8ef7ff', textTransform: 'uppercase',
      }}
    >
      <strong style={{ color: '#3df0ff' }}>Read-only demo</strong>
      <span style={{ color: '#5d7f8a' }}>seeded data, no backend, nothing here can send or spend</span>
      <a
        href="https://github.com/ethan-goldstein/Autonomous-OS"
        target="_blank"
        rel="noreferrer"
        style={{ color: '#3df0ff', textDecoration: 'underline' }}
      >
        source
      </a>
    </div>
  );
}
