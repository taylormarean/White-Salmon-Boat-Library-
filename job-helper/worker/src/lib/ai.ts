// Thin wrapper around the Claude API: structured JSON calls, plain-text calls, and the
// web-search "job scout". Every call streams (long resume drafts can't time out), opts into
// server-side refusal fallbacks, and checks stop_reason before reading content.
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../env';
import { guardSpend, recordUsage, type UsageLike } from '../billing';

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
type Block = Anthropic.Beta.BetaContentBlockParam;

export class AIError extends Error {}

export function aiConfigured(env: Env): boolean {
  return env.MOCK_AI === '1' || !!env.ANTHROPIC_API_KEY;
}

function client(env: Env): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new AIError('ANTHROPIC_API_KEY is not set — add it with `wrangler secret put ANTHROPIC_API_KEY`.');
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 3 });
}

function model(env: Env): string {
  return env.AI_MODEL || 'claude-opus-5-5';
}

function checkStop(msg: Anthropic.Beta.BetaMessage): void {
  if (msg.stop_reason === 'refusal') {
    throw new AIError(`Claude declined this request${msg.stop_details?.explanation ? `: ${msg.stop_details.explanation}` : ''}`);
  }
  if (msg.stop_reason === 'max_tokens') throw new AIError('Claude ran out of room writing this — try again.');
}

function textOf(msg: Anthropic.Beta.BetaMessage): string {
  return msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
}

function systemBlocks(context: string | undefined, instructions: string): Anthropic.Beta.BetaTextBlockParam[] {
  // Her profile goes first and is cached — it's identical across every job scored in a run.
  const blocks: Anthropic.Beta.BetaTextBlockParam[] = [];
  if (context) blocks.push({ type: 'text', text: context, cache_control: { type: 'ephemeral' } });
  blocks.push({ type: 'text', text: instructions });
  return blocks;
}

export interface JsonCall<T> {
  purpose?: string; // shows up on her usage/billing page
  context?: string;
  instructions: string;
  user: string | Block[];
  schema: Record<string, unknown>;
  effort?: Effort;
  maxTokens?: number;
  mock: () => T;
}

export async function aiJSON<T>(env: Env, call: JsonCall<T>): Promise<T> {
  await guardSpend(env);
  if (env.MOCK_AI === '1') {
    await recordUsage(env, call.purpose ?? 'ai', model(env), MOCK_USAGE);
    return call.mock();
  }
  const stream = client(env).beta.messages.stream({
    model: model(env),
    max_tokens: call.maxTokens ?? 32000,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    system: systemBlocks(call.context, call.instructions),
    messages: [{ role: 'user', content: call.user }],
    output_config: { effort: call.effort ?? 'medium', format: { type: 'json_schema', schema: call.schema } },
  });
  const msg = await stream.finalMessage();
  await recordUsage(env, call.purpose ?? 'ai', msg.model, msg.usage as UsageLike);
  checkStop(msg);
  try {
    return JSON.parse(textOf(msg)) as T;
  } catch {
    throw new AIError('Claude returned something that was not valid JSON.');
  }
}

export async function aiText(env: Env, call: { purpose?: string; context?: string; instructions: string; user: string | Block[]; effort?: Effort; maxTokens?: number; mock: () => string }): Promise<string> {
  await guardSpend(env);
  if (env.MOCK_AI === '1') {
    await recordUsage(env, call.purpose ?? 'ai', model(env), MOCK_USAGE);
    return call.mock();
  }
  const stream = client(env).beta.messages.stream({
    model: model(env),
    max_tokens: call.maxTokens ?? 32000,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    system: systemBlocks(call.context, call.instructions),
    messages: [{ role: 'user', content: call.user }],
    output_config: { effort: call.effort ?? 'low' },
  });
  const msg = await stream.finalMessage();
  await recordUsage(env, call.purpose ?? 'ai', msg.model, msg.usage as UsageLike);
  checkStop(msg);
  return textOf(msg).trim();
}

/**
 * Agentic web search: Claude searches the web (with her location) and reports postings
 * through a strict `save_jobs` tool. Handles pause_turn continuation.
 */
export async function aiWebScout<T>(env: Env, call: {
  context: string;
  instructions: string;
  user: string;
  location?: Anthropic.Beta.BetaUserLocation;
  saveSchema: Record<string, unknown>;
  mock: () => T;
  purpose?: string;
  toolName?: string;
  maxSearches?: number;
}): Promise<T | null> {
  const toolName = call.toolName ?? 'save_jobs';
  await guardSpend(env);
  if (env.MOCK_AI === '1') {
    await recordUsage(env, call.purpose ?? 'web search', model(env), { ...MOCK_USAGE, server_tool_use: { web_search_requests: 3 } });
    return call.mock();
  }
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    { type: 'web_search_20260209', name: 'web_search', max_uses: call.maxSearches ?? 10, ...(call.location ? { user_location: call.location } : {}) },
    {
      name: toolName,
      description: toolName === 'save_jobs' ? 'Save the job postings you found. Call this exactly once, at the end, with every qualifying posting.' : 'Save your findings. Call this exactly once, at the end.',
      strict: true,
      input_schema: call.saveSchema as Anthropic.Beta.BetaTool.InputSchema,
    },
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: call.user }];
  for (let turn = 0; turn < 4; turn++) {
    const msg = await client(env).beta.messages.stream({
      model: model(env),
      max_tokens: 32000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      system: systemBlocks(call.context, call.instructions),
      tools,
      tool_choice: { type: 'auto' },
      messages,
      output_config: { effort: 'medium' },
    }).finalMessage();
    await recordUsage(env, call.purpose ?? 'web search', msg.model, msg.usage as UsageLike);
    checkStop(msg);
    const save = msg.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === toolName);
    if (save) return save.input as T;
    if (msg.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: msg.content });
      continue;
    }
    // Finished without saving — nudge once.
    messages.push({ role: 'assistant', content: msg.content });
    messages.push({ role: 'user', content: `Please call ${toolName} now with what you found.` });
  }
  return null;
}

// Test mode still meters a plausible amount, so billing can be exercised end to end.
const MOCK_USAGE: UsageLike = { input_tokens: 3000, output_tokens: 800, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 };

export function pdfBlock(base64: string): Block {
  return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
}

/** A multi-turn conversation (practice role-plays). Returns the assistant's next line. */
export async function aiChat(env: Env, call: { purpose: string; system: string; messages: { role: 'user' | 'assistant'; content: string }[]; effort?: Effort; maxTokens?: number; mock: () => string; free?: boolean }): Promise<string> {
  // free: the business pays (e.g. support chat) — works even when the customer is out of credit.
  await guardSpend(env, { free: call.free });
  if (env.MOCK_AI === '1') {
    await recordUsage(env, call.purpose, model(env), MOCK_USAGE, { free: call.free });
    return call.mock();
  }
  const msg = await client(env).beta.messages.stream({
    model: model(env),
    max_tokens: call.maxTokens ?? 8000,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    system: [{ type: 'text', text: call.system, cache_control: { type: 'ephemeral' } }],
    messages: call.messages,
    output_config: { effort: call.effort ?? 'low' },
  }).finalMessage();
  await recordUsage(env, call.purpose, msg.model, msg.usage as UsageLike, { free: call.free });
  checkStop(msg);
  return textOf(msg).trim();
}

/** Research with web search, reported through a strict tool (works with citations, unlike JSON mode). */
export async function aiResearch<T>(env: Env, call: { purpose: string; context?: string; instructions: string; user: string; schema: Record<string, unknown>; toolName: string; maxSearches?: number; mock: () => T }): Promise<T | null> {
  return aiWebScout<T>(env, {
    purpose: call.purpose,
    context: call.context ?? '',
    instructions: call.instructions,
    user: call.user,
    saveSchema: call.schema,
    mock: call.mock,
    toolName: call.toolName,
    maxSearches: call.maxSearches,
  });
}
