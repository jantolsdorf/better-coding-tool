import { beforeEach, describe, expect, it } from 'vitest';
import { aiBatches, ANSWER_FORMATS, applyAiSuggestions, buildMessages, DEFAULT_PROMPTS, locateQuote, parseAnswer, type AiJob } from '../src/model/aiCoding';
import { codeForPath } from '../src/model/codes';
import { project } from '../src/model/state';
import type { Doc } from '../src/model/types';
import { freshProject } from './helpers';

const TEXT = [
  'Interviewer: How do you manage passwords?',
  'Participant: I reuse two or three. I know that\'s not great, but there are too many accounts.',
  '',
  'Interviewer: And at work?',
  'Participant: Every site has different rules, so I write them down.',
].join('\n');

let doc: Doc;
let job: AiJob;

beforeEach(() => {
  [doc] = freshProject(TEXT);
  const trust = codeForPath('Trust');
  trust.description = 'Statements about trusting systems or people';
  const rules = codeForPath('Rules > Workarounds');
  job = {
    codeIds: [trust.id, rules.id],
    docIds: [doc.id],
    split: { mode: 'paragraph', paragraphBreak: 'blank', separators: [] },
    examplesPerCode: 0,
    batchChars: 6000,
  };
});

describe('locateQuote', () => {
  it('finds quotes exactly, across other whitespace, and with other quotation marks', () => {
    const exact = 'I know that\'s not great';
    expect(locateQuote(TEXT, 0, TEXT.length, exact)).toEqual([TEXT.indexOf(exact), TEXT.indexOf(exact) + exact.length]);
    const loose = locateQuote(TEXT, 0, TEXT.length, '“I know that’s   not great,\nbut there”');
    expect(loose && TEXT.slice(...loose)).toBe('I know that\'s not great, but there');
  });

  it('only searches the given range and reports quotes that are not there', () => {
    expect(locateQuote(TEXT, 0, 10, 'Participant')).toBeNull();
    expect(locateQuote(TEXT, 0, TEXT.length, 'a sentence that does not occur')).toBeNull();
  });
});

describe('requests', () => {
  it('sends paragraphs together up to the size limit, and documents in pieces', () => {
    expect(aiBatches(job)).toHaveLength(1);
    expect(aiBatches({ ...job, batchChars: 50 })).toHaveLength(2);
    const pieces = aiBatches({ ...job, split: { mode: 'document' }, batchChars: 80 });
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.map((b) => TEXT.slice(b[0].start, b[0].end)).join('')).toBe(TEXT);
  });

  it('gives codes as short ids with path and definition, and shares examples only if asked', () => {
    const [batch] = aiBatches(job);
    const prompt = buildMessages(job, batch)[1].content;
    expect(prompt).toContain('C1: Trust\n  Definition: Statements about trusting systems or people');
    expect(prompt).toContain('C2: Rules > Workarounds');
    expect(prompt).toContain('[P2]\nInterviewer: And at work?');
    expect(prompt).not.toContain('Example:');

    project.segments.push({ id: 's1', docId: doc.id, codeId: job.codeIds[0], start: 0, end: 11, text: 'Interviewer', createdAt: '' });
    expect(buildMessages({ ...job, examplesPerCode: 2 }, batch)[1].content).toContain('Example: "Interviewer"');
  });
});

describe('custom prompts', () => {
  it('uses your wording, keeps the answer format, and falls back to the default for empty texts', () => {
    const [batch] = aiBatches(job);
    const [system, user] = buildMessages(job, batch, { system: 'Be strict.', paragraphTask: 'Code each turn.', documentTask: '' });
    expect(system.content).toBe('Be strict.');
    expect(user.content).toContain(`Code each turn.\n${ANSWER_FORMATS.paragraph}`);
    expect(user.content).not.toContain(DEFAULT_PROMPTS.paragraphTask);

    const [, docUser] = buildMessages({ ...job, split: { mode: 'document' } }, aiBatches({ ...job, split: { mode: 'document' } })[0], { documentTask: ' ' });
    expect(docUser.content).toContain(`${DEFAULT_PROMPTS.documentTask}\n${ANSWER_FORMATS.document}`);
  });
});

describe('parseAnswer', () => {
  it('turns a paragraph answer (also in a ```json block) into suggestions, coding the whole paragraph if nothing is quoted, and reports unknown codes and passages', () => {
    const [batch] = aiBatches(job);
    const answer = '```json\n' + JSON.stringify({
      results: [
        { passage: 'P1', codes: [{ code: 'C1', reason: 'Trust.' }, { code: 'C9' }] },
        { passage: 'P7', codes: [{ code: 'C2' }] },
        { passage: 'P2', codes: [{ code: 'C2', reason: 'Rules.' }] },
      ],
    }) + '\n```';
    const { suggestions, problems } = parseAnswer(job, batch, answer);
    expect(suggestions.map((s) => [TEXT.slice(s.start, s.end).slice(0, 15), s.codeId, s.reason])).toEqual([
      ['Interviewer: Ho', job.codeIds[0], 'Trust.'],
      ['Interviewer: An', job.codeIds[1], 'Rules.'],
    ]);
    expect(problems).toHaveLength(2);
  });

  it('codes only the quoted sentences of a paragraph, widened to whole words, with the paragraph as context', () => {
    const [batch] = aiBatches(job);
    const answer = JSON.stringify({
      results: [
        {
          passage: 'P1',
          codes: [
            { code: 'C1', quote: 'I know that’s not great', reason: 'Trust.' },
            { code: 'C2', quote: 'euse two or thr' },
            { code: 'C1', quote: 'I know that\'s not great' }, // the same again: listed once
            { code: 'C2', quote: 'Every site has different rules' }, // in P2, not in P1
          ],
        },
      ],
    });
    const { suggestions, problems } = parseAnswer(job, batch, answer);
    expect(suggestions.map((s) => TEXT.slice(s.start, s.end))).toEqual(['I know that\'s not great', 'reuse two or three']);
    expect(suggestions[0].context).toEqual([batch[0].start, batch[0].end]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('was not found');
  });

  it('finds quoted passages of a document answer', () => {
    const docJob: AiJob = { ...job, split: { mode: 'document' } };
    const [batch] = aiBatches(docJob);
    const answer = JSON.stringify({ results: [{ code: 'C2', quote: 'Every site has different rules', reason: 'Rules.' }, { code: 'C1', quote: 'not in the text' }] });
    const { suggestions, problems } = parseAnswer(docJob, batch, answer);
    expect(suggestions).toHaveLength(1);
    expect(TEXT.slice(suggestions[0].start, suggestions[0].end)).toBe('Every site has different rules');
    expect(TEXT.slice(...suggestions[0].context)).toBe('Participant: Every site has different rules, so I write them down.');
    expect(problems[0]).toContain('was not found');
  });

  it('marks suggestions that your coding already has', () => {
    const [batch] = aiBatches(job);
    const first = batch[0];
    project.segments.push({ id: 's1', docId: doc.id, codeId: job.codeIds[0], start: first.start, end: first.end, text: '', createdAt: '' });
    const answer = JSON.stringify({ results: [{ passage: 'P1', codes: [{ code: 'C1' }] }] });
    expect(parseAnswer(job, batch, answer).suggestions[0].alreadyCoded).toBe(true);
  });

  it('rejects answers that are not JSON', () => {
    expect(() => parseAnswer(job, aiBatches(job)[0], 'Sorry, I cannot help.')).toThrow();
  });
});

describe('applyAiSuggestions', () => {
  it('codes the suggestions in your coding, with you as the author', () => {
    const [batch] = aiBatches(job);
    const { suggestions } = parseAnswer(job, batch, JSON.stringify({ results: [{ passage: 'P2', codes: [{ code: 'C2' }] }] }));
    expect(applyAiSuggestions(suggestions)).toEqual({ added: 1, extended: 0 });
    expect(project.segments).toHaveLength(1);
    expect(project.segments[0]).toMatchObject({ codeId: job.codeIds[1], author: 'Tester', text: TEXT.slice(batch[1].start, batch[1].end) });
    // Applying again changes nothing.
    expect(applyAiSuggestions(suggestions)).toEqual({ added: 0, extended: 0 });
  });
});
