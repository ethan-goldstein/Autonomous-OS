// LLM dispatcher: Claude (subscription, premium quality) first, local Ollama
// as the always-on fallback. Mirrors ollama.js's export surface exactly so
// agents swap a single import path and nothing else.
//
// Failure policy: any Claude error (timeout, rate-limit window, CLI missing)
// puts Claude in a 10-minute cooldown and the call transparently retries on
// Ollama. checkLLM().ok is true when EITHER brain is usable.
import * as ollama from './ollama.js';
import { claudeAvailable, claudeChat, CLAUDE_ENABLED, CLAUDE_MODEL } from './claude.js';
import { getKV, setKV } from '../db.js';

export { OLLAMA_URL, MODEL } from './ollama.js';

const COOLDOWN_KEY = 'llm:claudeCooldownUntil';
const COOLDOWN_MS = 10 * 60 * 1000;

function inCooldown() {
  return Date.now() < Number(getKV(COOLDOWN_KEY, 0));
}

function startCooldown(err) {
  setKV(COOLDOWN_KEY, Date.now() + COOLDOWN_MS);
  console.warn(`[llm] claude failed (${err.message}) — falling back to ollama for 10 min`);
}

async function claudeUsable() {
  return CLAUDE_ENABLED && !inCooldown() && (await claudeAvailable());
}

/**
 * Health check for the whole brain. Keeps the checkOllama name/shape agents
 * already gate on: `ok` is true if either provider can serve calls.
 */
export async function checkLLM() {
  const [claudeOk, ollamaStatus] = await Promise.all([claudeUsable(), ollama.checkOllama()]);
  return {
    ok: claudeOk || ollamaStatus.ok,
    provider: claudeOk ? 'claude' : ollamaStatus.ok ? 'ollama' : null,
    claude: { ok: claudeOk, enabled: CLAUDE_ENABLED, model: CLAUDE_MODEL, coolingDown: inCooldown() },
    ollama: ollamaStatus,
    // Back-compat with ollama.checkOllama() consumers reading these fields:
    hasModel: claudeOk || ollamaStatus.hasModel,
    models: ollamaStatus.models,
    reason: claudeOk || ollamaStatus.ok ? undefined : ollamaStatus.reason,
  };
}
export { checkLLM as checkOllama };

export async function chat(prompt, opts = {}) {
  if (await claudeUsable()) {
    try {
      return await claudeChat({ system: opts.system, prompt, json: opts.format === 'json' });
    } catch (err) {
      startCooldown(err);
    }
  }
  return ollama.chat(prompt, opts);
}

export async function chatMessages(messages, opts = {}) {
  if (await claudeUsable()) {
    try {
      // Claude headless is one-shot: system goes to --append-system-prompt,
      // the rest of the conversation is flattened into a transcript prompt.
      const system = messages[0]?.role === 'system' ? messages[0].content : undefined;
      const turns = messages[0]?.role === 'system' ? messages.slice(1) : messages;
      const transcript = turns
        .map((m) => `${m.role === 'assistant' ? 'CORE' : 'Owner'}: ${m.content}`)
        .join('\n');
      return await claudeChat({ system, prompt: `${transcript}\n\nReply as CORE:` });
    } catch (err) {
      startCooldown(err);
    }
  }
  return ollama.chatMessages(messages, opts);
}

/** Same tolerant contract as ollama.chatJSON: returns an object or null. */
export async function chatJSON(prompt, opts = {}) {
  if (await claudeUsable()) {
    try {
      const raw = await claudeChat({ system: opts.system, prompt, json: true });
      return parseLoose(raw);
    } catch (err) {
      startCooldown(err);
    }
  }
  return ollama.chatJSON(prompt, opts);
}

function parseLoose(raw) {
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
