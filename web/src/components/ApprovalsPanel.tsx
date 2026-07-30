import { useCallback, useEffect, useState } from 'react';
import type { Approval, ApprovalEvent } from '../types';

// The approval queue — every outward-facing action the fleet wants to take.
// Safe lanes (your own store / page / site) auto-post when their toggle is on
// and still show up here as history; risky lanes (X, Services, cold email) wait
// for your tap. X posts open a prefilled composer — free, no API bill.

const KIND_META: Record<Approval['kind'], { icon: string; label: string }> = {
  public_post: { icon: '𝕏', label: 'PUBLIC POST' },
  owned_post: { icon: '📘', label: 'OWNED PAGE' },
  owned_publish: { icon: '🎨', label: 'OWNED SITE' },
  outbound_batch: { icon: '✉️', label: 'OUTBOUND' },
  listing_publish: { icon: '🛍', label: 'MARKETPLACE' },
  service_draft: { icon: '💼', label: 'SERVICES' },
};

const STATUS_META: Record<Approval['status'], { label: string; color: string }> = {
  pending: { label: '⏳ AWAITING YOUR TAP', color: 'var(--amber, #f5a623)' },
  approved: { label: '☑ APPROVED — FINISH THE TAP', color: 'var(--amber, #f5a623)' },
  posted: { label: '✅ POSTED', color: 'var(--accent)' },
  auto_posted: { label: '⚡ AUTO-POSTED', color: 'var(--accent)' },
  rejected: { label: '✕ REJECTED', color: 'rgba(255,255,255,0.35)' },
  error: { label: '⚠ ERROR', color: 'var(--red, #ff5c5c)' },
};

interface Settings {
  'autopost:owned': boolean;
  'autopost:owned2': boolean;
  'outbound:mode': 'auto' | 'approval' | 'off';
  fbLive: boolean;
}

export function ApprovalsPanel({ lastApproval, onBack }: { lastApproval: ApprovalEvent | null; onBack: () => void }) {
  const [items, setItems] = useState<(Approval & { image?: string | null })[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [actingId, setActingId] = useState<number | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    fetch('/api/approvals')
      .then((r) => r.json())
      .then((d) => { setItems(d.items || []); setCounts(d.counts || {}); setSettings(d.settings || null); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => { load(); }, [lastApproval, load]); // live SSE nudge

  const act = async (id: number, action: 'approve' | 'reject' | 'posted') => {
    if (actingId) return;
    setActingId(id); setErr('');
    try {
      const r = await fetch(`/api/approvals/${id}/${action}`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `${action} failed`);
      load();
    } catch (e: any) { setErr(e.message); }
    setActingId(null);
  };

  const setSetting = async (key: string, value: unknown) => {
    try {
      const r = await fetch('/api/approvals/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      const d = await r.json();
      if (r.ok) setSettings(d.settings);
    } catch { /* refresh will catch up */ }
  };

  const pending = items.filter((i) => i.status === 'pending' || i.status === 'approved');
  const history = items.filter((i) => i.status !== 'pending' && i.status !== 'approved');
  const shown = tab === 'pending' ? pending : history;

  return (
    <div className="section glass">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 10 }}>
        <h4 style={{ margin: 0 }}>🛰 Approval Queue</h4>
        <button className="ghost-btn sm" onClick={onBack}>← back to the nexus</button>
      </div>
      <p className="note">
        Every outward action the fleet wants to take lands here. Safe lanes (your own store, page, site)
        can auto-post; X, Services and cold email always wait for <b>your</b> tap.
      </p>

      {settings && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', padding: '10px 12px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, marginBottom: 14, fontSize: 13 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={settings['autopost:owned']} onChange={(e) => setSetting('autopost:owned', e.target.checked)} />
            📘 Facebook auto-post{!settings.fbLive && <span style={{ opacity: 0.5 }}>(connect the Page first)</span>}
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={settings['autopost:owned2']} onChange={(e) => setSetting('autopost:owned2', e.target.checked)} />
            🎨 OWNED SITE auto-publish
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            ✉️ Cold email:
            <select value={settings['outbound:mode']} onChange={(e) => setSetting('outbound:mode', e.target.value)} style={{ background: 'transparent', color: 'inherit', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, padding: '2px 6px' }}>
              <option value="auto">auto-send daily</option>
              <option value="approval">queue for my tap</option>
              <option value="off">off</option>
            </select>
          </label>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className={tab === 'pending' ? 'btn' : 'ghost-btn'} onClick={() => setTab('pending')}>
          ⏳ PENDING ({pending.length})
        </button>
        <button className={tab === 'history' ? 'btn' : 'ghost-btn'} onClick={() => setTab('history')}>
          🗂 HISTORY ({(counts.posted ?? 0) + (counts.auto_posted ?? 0) + (counts.rejected ?? 0) + (counts.error ?? 0)})
        </button>
      </div>

      {err && <div className="note" style={{ color: 'var(--red)' }}>⚠ {err}</div>}
      {shown.length === 0 && (
        <p className="empty" style={{ margin: 0 }}>
          {tab === 'pending' ? 'Nothing waiting — the fleet is clear.' : 'No history yet.'}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {shown.map((a) => {
          const k = KIND_META[a.kind] ?? { icon: '•', label: a.kind };
          const s = STATUS_META[a.status];
          const intentUrl = a.kind === 'public_post' && a.payload?.text
            ? `https://twitter.com/intent/post?text=${encodeURIComponent(a.payload.text)}`
            : null;
          return (
            <div key={a.id} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: 14, display: 'flex', gap: 14 }}>
              {a.image && (
                <img src={a.image} alt="" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <strong style={{ fontSize: 14 }}>{k.icon} {a.title}</strong>
                  <span style={{ color: s.color, fontSize: 11, letterSpacing: 1 }}>{s.label}</span>
                </div>
                {a.summary && <div className="note" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{a.summary}</div>}
                {a.error_msg && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 4 }}>{a.error_msg}</div>}
                <div style={{ fontSize: 11, opacity: 0.5, marginTop: 6 }}>
                  {k.label} · {a.risk === 'safe' ? 'safe lane' : 'needs your tap'} · {new Date(a.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </div>
                {(a.status === 'pending' || a.status === 'approved') && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    {intentUrl ? (
                      <>
                        <a className="btn" href={intentUrl} target="_blank" rel="noreferrer">𝕏 OPEN COMPOSER</a>
                        <button className="ghost-btn" onClick={() => act(a.id, 'posted')} disabled={actingId === a.id}>✓ I POSTED IT</button>
                      </>
                    ) : (
                      a.status === 'pending' && (
                        <button className="btn" onClick={() => act(a.id, 'approve')} disabled={actingId === a.id}>
                          {actingId === a.id ? 'WORKING…' : '▰ APPROVE'}
                        </button>
                      )
                    )}
                    {a.status === 'pending' && (
                      <button className="ghost-btn" onClick={() => act(a.id, 'reject')} disabled={actingId === a.id}>✕ reject</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
