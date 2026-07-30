import { useEffect, useRef, useState } from 'react';
import type { Agent } from '../types';

const SYN: Record<string, string[]> = {
  finance: ['finance', 'agent', 'money', 'financial', 'accounts'],
  email: ['email', 'mail', 'agent', 'inbox', 'emails'],
  sourcing: ['sourcing', 'sourcing', 'agent', 'product', 'products', 'reselling'],
  scout: ['lead', 'leads', 'outbound', 'agent', 'contacts', 'contacts', 'clients', 'websites'],
  brief: ['brief', 'briefing', 'mom', 'morning', 'rundown'],
  services: ['services', 'services', 'agent', 'thumbnail', 'thumbnails', 'studio'],
  core: ['command', 'core', 'orchestrator', 'overseer'],
  nexus: ['home', 'nexus', 'dashboard'],
};
const NAV_VERBS = /\b(go to|open|show|take me|navigate|pull up|bring up|jump to|switch to|head to)\b/;
const RUN_VERBS = /\b(run|refresh|scan|update|generate|find me|hunt)\b/;

function findTarget(text: string): string | null {
  for (const [id, words] of Object.entries(SYN)) if (words.some((w) => text.includes(w))) return id;
  return null;
}

// Pick the most natural British MALE voice available.
function pickBritishVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const gb = voices.filter((v) => /en[-_]?GB/i.test(v.lang) || /united kingdom|british/i.test(v.name));
  const male = /daniel|oliver|arthur|george|graham|jamie|malcolm|ryan|thomas|reed|albert|kingsley/i;
  const quality = /enhanced|premium|natural|neural|siri/i;
  const pool = gb.length ? gb : voices.filter((v) => /^en/i.test(v.lang));
  const rank = (v: SpeechSynthesisVoice) => (quality.test(v.name) ? 2 : 0) + (male.test(v.name) ? 1 : 0);
  pool.sort((a, b) => rank(b) - rank(a));
  return pool.find((v) => male.test(v.name)) || pool[0] || null;
}

export function VoiceControl({
  agents,
  currentView,
  onNavigate,
  onRun,
}: {
  agents: Agent[];
  currentView: string;
  onNavigate: (v: string) => void;
  onRun: (id: string) => void;
}) {
  const supported = typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');
  const recRef = useRef<any>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  // Voices load async — grab the British voice once they're ready.
  useEffect(() => {
    const load = () => { voiceRef.current = pickBritishVoice(); };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  const speak = (t: string) => {
    if (!t) return;
    try {
      const u = new SpeechSynthesisUtterance(t);
      const v = voiceRef.current || pickBritishVoice();
      if (v) u.voice = v;
      u.lang = 'en-GB';
      u.rate = 0.96; // a touch slower = more natural, less robotic
      u.pitch = 1.0;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  };
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name || id;

  async function handle(text: string) {
    setHeard(text);
    const t = text.toLowerCase();
    const target = findTarget(t);
    const nav = NAV_VERBS.test(t), run = RUN_VERBS.test(t), pageWord = /\bpage\b/.test(t);

    if (target === 'brief' && /brief|morning|rundown/.test(t)) {
      onNavigate('brief'); speak('Pulling up your morning brief.'); setReply('Running your morning brief…');
      try {
        await fetch('/api/agents/brief/run', { method: 'POST' });
        for (let i = 0; i < 25; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const d = await fetch('/api/agents/brief').then((r) => r.json());
          if (d.status !== 'working') {
            const res = d.latest?.result;
            if (res?.headline) {
              const todos = (res.todos || []).slice(0, 3).join('. ');
              const msg = `${res.headline} ${todos ? 'Top tasks: ' + todos : ''}`;
              setReply(msg); speak(msg);
            }
            break;
          }
        }
      } catch { /* ignore */ }
      return;
    }

    if (target && (nav || run || pageWord)) {
      if (run && target !== 'nexus' && target !== 'core') {
        onRun(target); onNavigate(target);
        const m = `Running ${nameOf(target)}.`; setReply(m); speak(m);
      } else {
        onNavigate(target);
        const m = `Opening ${nameOf(target)}.`; setReply(m); speak(m);
      }
      return;
    }

    setReply('CORE is thinking…');
    try {
      const agentId = ['nexus', 'core'].includes(currentView) ? undefined : currentView;
      const d = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, agentId }),
      }).then((r) => r.json());
      const r = d.reply || d.error || 'No response.';
      setReply(r); speak(r);
    } catch (e: any) { setReply('Error: ' + e.message); }
  }

  function start() {
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onresult = (e: any) => handle(e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setHeard(''); setReply(''); setListening(true);
    try { rec.start(); } catch { setListening(false); }
  }
  function stop() { try { recRef.current?.stop(); } catch { /* ignore */ } setListening(false); }

  if (!supported) return null;

  return (
    <>
      <button className={`mic-fab ${listening ? 'on' : ''}`} onClick={() => (listening ? stop() : start())} title="Talk to CORE">
        {listening ? '◉' : '🎙'}
      </button>
      {(listening || heard || reply) && (
        <div className="voice-overlay glass">
          <div className="voice-top">
            <span className="voice-status">{listening ? '● LISTENING…' : 'core os'}</span>
            <button className="voice-x" onClick={() => { setHeard(''); setReply(''); stop(); }}>✕</button>
          </div>
          {heard && <div className="voice-heard">“{heard}”</div>}
          {reply && <div className="voice-reply">{reply}</div>}
        </div>
      )}
    </>
  );
}
