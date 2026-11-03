// AI coding: the requests to an OpenAI-compatible chat completions API, running a job request by
// request (with progress and cancelling), and applying the accepted suggestions. This is the
// only part of the tool that sends anything over the network, and only when the user starts it.

import { aiBatches, applyAiSuggestions, buildMessages, parseAnswer, type AiJob, type AiSuggestion, type ChatMessage } from '../model/aiCoding';
import type { AiSettings } from '../model/aiSettings';
import { toast } from '../view/feedback';

const endpoint = (s: AiSettings, path: string) => `${s.baseUrl.trim().replace(/\/+$/, '')}/${path}`;

const headers = (s: AiSettings): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(s.apiKey.trim() ? { Authorization: `Bearer ${s.apiKey.trim()}` } : {}),
});

/** A readable error from a failed response (OpenAI-style `{error: {message}}` if possible). */
async function failure(res: Response): Promise<Error> {
  let detail = '';
  try {
    const body = await res.text();
    try {
      const json = JSON.parse(body);
      detail = json?.error?.message ?? json?.message ?? body;
    } catch {
      detail = body;
    }
  } catch {
    // No body.
  }
  const hint = res.status === 401 ? ' Check the API key.' : res.status === 404 ? ' Check the base URL and the model.' : '';
  return new Error(`The server answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''}${detail ? `: ${String(detail).slice(0, 300)}` : ''}.${hint}`);
}

/** Network errors (no answer at all), e.g. a wrong URL or a server that does not allow browser requests. */
function unreachable(s: AiSettings, e: unknown): Error {
  if (e instanceof DOMException && e.name === 'AbortError') return e as Error;
  return new Error(
    `Could not reach ${s.baseUrl}. Check the URL and your connection. A local server must allow requests from this page (CORS).`,
  );
}

/** One chat completion; resolves with the answer's text. */
export async function chatCompletion(s: AiSettings, messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  const send = (json: boolean) =>
    fetch(endpoint(s, 'chat/completions'), {
      method: 'POST',
      headers: headers(s),
      signal,
      body: JSON.stringify({
        model: s.model.trim(),
        messages,
        temperature: s.temperature,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
  let res: Response;
  try {
    res = await send(s.jsonMode);
    // Servers without JSON mode refuse it: once more without (the prompt asks for JSON anyway).
    if (!res.ok && s.jsonMode && res.status === 400) {
      const retry = await send(false);
      if (retry.ok) res = retry;
    }
  } catch (e) {
    throw unreachable(s, e);
  }
  if (!res.ok) throw await failure(res);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('The answer has no text (unexpected response format).');
  return text;
}

/** The models the server offers (if it lists them). */
export async function listModels(s: AiSettings): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(endpoint(s, 'models'), { headers: headers(s) });
  } catch (e) {
    throw unreachable(s, e);
  }
  if (!res.ok) throw await failure(res);
  const data = await res.json();
  return (Array.isArray(data?.data) ? data.data : []).map((m: { id?: string }) => m.id).filter(Boolean).sort();
}

/** A minimal request to check URL, key and model. */
export async function testConnection(s: AiSettings): Promise<void> {
  await chatCompletion({ ...s, jsonMode: false }, [{ role: 'user', content: 'Reply with OK.' }]);
}

export interface AiProgress {
  done: number;
  total: number;
  suggestions: AiSuggestion[];
  problems: string[];
}

/**
 * Runs a job request by request. `onProgress` gets the new suggestions after each request.
 * A failed request is reported as a problem and the job goes on, unless all of the first
 * requests fail (then the settings are likely wrong) or it is cancelled.
 */
export async function runAiJob(s: AiSettings, job: AiJob, signal: AbortSignal, onProgress: (p: AiProgress) => void): Promise<void> {
  const batches = aiBatches(job);
  const seen = new Set<string>();
  let failures = 0;
  for (const [i, batch] of batches.entries()) {
    if (signal.aborted) return;
    const progress: AiProgress = { done: i + 1, total: batches.length, suggestions: [], problems: [] };
    try {
      const answer = await chatCompletion(s, buildMessages(job, batch, s.prompts), signal);
      const parsed = parseAnswer(job, batch, answer);
      progress.suggestions = parsed.suggestions.filter((x) => !seen.has(x.key) && seen.add(x.key));
      progress.problems = parsed.problems;
    } catch (e) {
      if (signal.aborted) return;
      failures++;
      progress.problems = [`Request ${i + 1} of ${batches.length}: ${(e as Error).message}`];
      if (failures === i + 1 && failures >= 2) {
        onProgress(progress);
        throw new Error(`The first ${failures} requests failed; stopped. ${(e as Error).message}`);
      }
    }
    onProgress(progress);
  }
}

/** Applies the accepted suggestions to your coding and says what happened. */
export function applyAccepted(list: AiSuggestion[]): boolean {
  const accepted = list.filter((s) => s.status === 'accepted');
  if (!accepted.length) return false;
  const res = applyAiSuggestions(accepted);
  const total = res.added + res.extended;
  toast(
    total
      ? `Coded ${total} passage${total === 1 ? '' : 's'} from the AI suggestions${res.extended ? ` (${res.extended} extended an existing segment)` : ''}. Undo reverts it.`
      : 'All accepted passages were already coded.',
    6000,
  );
  return true;
}
