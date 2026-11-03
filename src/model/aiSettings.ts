// Settings for AI coding: an OpenAI-compatible chat completions API (OpenAI, or e.g. a local
// server). Kept in this browser only, apart from the project, so the API key is never part of
// an exported project. The key is remembered only if asked to; otherwise only until the tab closes.

import { DEFAULT_PROMPTS, type AiPrompts } from './aiCoding';

const KEY = 'bct:ai:v1';
const SESSION_KEY = 'bct:ai-key';

export interface AiSettings {
  /** Base URL of the API, e.g. https://api.openai.com/v1 (requests go to …/chat/completions). */
  baseUrl: string;
  apiKey: string;
  /** Keep the key in this browser's storage (otherwise only for this tab's session). */
  rememberKey: boolean;
  model: string;
  temperature: number;
  /** Ask for a JSON response (`response_format`); some servers do not support it. */
  jsonMode: boolean;
  /** How many characters of text one request holds at most. */
  batchChars: number;
  /** The prompt's wording (see aiCoding.ts). */
  prompts: AiPrompts;
}

export const DEFAULT_AI: AiSettings = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  rememberKey: false,
  model: '',
  temperature: 0,
  jsonMode: true,
  batchChars: 6000,
  prompts: DEFAULT_PROMPTS,
};

export function loadAiSettings(): AiSettings {
  let saved: Partial<AiSettings> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    // Unreadable settings: start from the defaults.
  }
  const s = { ...DEFAULT_AI, ...saved };
  s.prompts = { ...DEFAULT_PROMPTS, ...saved.prompts };
  if (!s.rememberKey) s.apiKey = sessionStorage.getItem(SESSION_KEY) ?? '';
  return s;
}

export function saveAiSettings(s: AiSettings) {
  const { apiKey, ...rest } = s;
  // Only the prompt texts that differ from the defaults, so improved defaults reach everyone else.
  const prompts = Object.fromEntries(Object.entries(s.prompts).filter(([k, v]) => v.trim() && v !== DEFAULT_PROMPTS[k as keyof AiPrompts]));
  localStorage.setItem(KEY, JSON.stringify({ ...(s.rememberKey ? s : rest), prompts }));
  if (s.rememberKey) sessionStorage.removeItem(SESSION_KEY);
  else if (apiKey) sessionStorage.setItem(SESSION_KEY, apiKey);
  else sessionStorage.removeItem(SESSION_KEY);
}

/** Whether requests can be made (a local server may need no key). */
export const aiConfigured = (s: AiSettings) => !!s.baseUrl.trim() && !!s.model.trim();

/** The host the text is sent to, for saying so before sending. */
export function aiHost(s: AiSettings): string {
  try {
    return new URL(s.baseUrl).host;
  } catch {
    return s.baseUrl;
  }
}
