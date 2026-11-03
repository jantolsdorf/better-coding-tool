import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatCompletion, runAiJob, type AiProgress } from '../src/controller/aiCoding';
import type { AiJob } from '../src/model/aiCoding';
import { DEFAULT_AI, type AiSettings } from '../src/model/aiSettings';
import { codeForPath } from '../src/model/codes';
import { freshProject } from './helpers';

const settings: AiSettings = { ...DEFAULT_AI, apiKey: 'sk-test', model: 'test-model' };
const reply = (content: string, status = 200) =>
  new Response(status === 200 ? JSON.stringify({ choices: [{ message: { content } }] }) : JSON.stringify({ error: { message: content } }), { status });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('chatCompletion', () => {
  it('posts to …/chat/completions with the key, model and JSON mode', async () => {
    fetchMock.mockResolvedValue(reply('OK'));
    await expect(chatCompletion({ ...settings, baseUrl: 'https://example.test/v1/' }, [{ role: 'user', content: 'hi' }])).resolves.toBe('OK');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.test/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body)).toMatchObject({ model: 'test-model', temperature: 0, response_format: { type: 'json_object' } });
  });

  it('retries without JSON mode when the server refuses it', async () => {
    fetchMock.mockResolvedValueOnce(reply('response_format is not supported', 400)).mockResolvedValueOnce(reply('OK'));
    await expect(chatCompletion(settings, [])).resolves.toBe('OK');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).response_format).toBeUndefined();
  });

  it('explains failures', async () => {
    fetchMock.mockResolvedValue(reply('Incorrect API key', 401));
    await expect(chatCompletion({ ...settings, jsonMode: false }, [])).rejects.toThrow(/401.*Incorrect API key.*Check the API key/);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(chatCompletion(settings, [])).rejects.toThrow(/Could not reach/);
  });
});

describe('runAiJob', () => {
  let job: AiJob;
  beforeEach(() => {
    const [doc] = freshProject('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.');
    job = {
      codeIds: [codeForPath('Trust').id],
      docIds: [doc.id],
      split: { mode: 'paragraph', paragraphBreak: 'blank', separators: [] },
      examplesPerCode: 0,
      batchChars: 20, // one paragraph per request
    };
  });

  it('runs request by request and reports progress, failed requests as problems', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(JSON.stringify({ results: [{ passage: 'P1', codes: [{ code: 'C1' }] }] })))
      .mockResolvedValueOnce(reply('boom', 500))
      .mockResolvedValueOnce(reply(JSON.stringify({ results: [] })));
    const progress: AiProgress[] = [];
    await runAiJob({ ...settings, jsonMode: false }, job, new AbortController().signal, (p) => progress.push(p));
    expect(progress.map((p) => [p.done, p.total, p.suggestions.length, p.problems.length])).toEqual([
      [1, 3, 1, 0],
      [2, 3, 0, 1],
      [3, 3, 0, 0],
    ]);
  });

  it('stops when the first requests all fail (likely wrong settings)', async () => {
    fetchMock.mockResolvedValue(reply('model not found', 404));
    await expect(runAiJob({ ...settings, jsonMode: false }, job, new AbortController().signal, () => {})).rejects.toThrow(/first 2 requests failed/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends nothing more once stopped', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async () => {
      controller.abort();
      return reply(JSON.stringify({ results: [] }));
    });
    await runAiJob(settings, job, controller.signal, () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
