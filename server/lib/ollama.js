// Thin client for the local Ollama server (the free, private "brain").
// Every call is wrapped with the security guardrails from guardrails.js —
// this is the single chokepoint, so no agent can talk to the model without them.
import { GUARDRAILS, withGuardrails } from './guardrails.js';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';

export { OLLAMA_URL, MODEL };

/** Returns true if Ollama is up and the configured model is pulled. */
export async function checkOllama() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const data = await res.json();
    const models = (data.models || []).map((m) => m.name);
    const hasModel = models.some((m) => m === MODEL || m.startsWith(MODEL.split(':')[0]));
    return { ok: true, hasModel, models };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Send a single prompt to the local model.
 * Pass { format: 'json' } to ask Ollama to constrain output to valid JSON.
 */
export async function chat(prompt, { system, format, temperature = 0.2 } = {}) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      format,
      options: { temperature },
      messages: [
        { role: 'system', content: withGuardrails(system) },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.message?.content ?? '';
}

/** Full multi-turn chat: pass an array of {role, content} messages. */
export async function chatMessages(messages, { temperature = 0.4 } = {}) {
  const withSys =
    messages[0]?.role === 'system'
      ? [{ role: 'system', content: withGuardrails(messages[0].content) }, ...messages.slice(1)]
      : [{ role: 'system', content: GUARDRAILS }, ...messages];
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, stream: false, options: { temperature }, messages: withSys }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.message?.content ?? '';
}

/** chat() that expects JSON back, with a tolerant fallback parser. */
export async function chatJSON(prompt, opts = {}) {
  const raw = await chat(prompt, { ...opts, format: 'json' });
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}
