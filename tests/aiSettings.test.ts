import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PROMPTS } from '../src/model/aiCoding';
import { aiConfigured, aiHost, DEFAULT_AI, loadAiSettings, saveAiSettings } from '../src/model/aiSettings';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('AI settings', () => {
  it('keeps the API key out of local storage unless it should be remembered', () => {
    saveAiSettings({ ...DEFAULT_AI, apiKey: 'sk-secret', model: 'm' });
    expect(JSON.stringify({ ...localStorage })).not.toContain('sk-secret');
    expect(loadAiSettings()).toMatchObject({ apiKey: 'sk-secret', model: 'm' });
    sessionStorage.clear(); // the tab is closed
    expect(loadAiSettings().apiKey).toBe('');

    saveAiSettings({ ...DEFAULT_AI, apiKey: 'sk-secret', model: 'm', rememberKey: true });
    sessionStorage.clear();
    expect(loadAiSettings().apiKey).toBe('sk-secret');
  });

  it('stores only the prompt texts you changed', () => {
    saveAiSettings({ ...DEFAULT_AI, prompts: { ...DEFAULT_PROMPTS, paragraphTask: 'Code each turn.' } });
    expect(JSON.parse(localStorage.getItem('bct:ai:v1')!).prompts).toEqual({ paragraphTask: 'Code each turn.' });
    expect(loadAiSettings().prompts).toEqual({ ...DEFAULT_PROMPTS, paragraphTask: 'Code each turn.' });
  });

  it('needs a URL and a model, but no key (local servers)', () => {
    expect(aiConfigured(DEFAULT_AI)).toBe(false);
    expect(aiConfigured({ ...DEFAULT_AI, model: 'llama3' })).toBe(true);
    expect(aiHost({ ...DEFAULT_AI, baseUrl: 'http://localhost:11434/v1' })).toBe('localhost:11434');
  });
});
