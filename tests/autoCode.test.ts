import { describe, expect, it } from 'vitest';
import { findOccurrences, paragraphs } from '../src/model/autoCode';

const slices = (text: string, ranges: [number, number][]) => ranges.map(([a, b]) => text.slice(a, b));

describe('findOccurrences', () => {
  const text = 'Trust me. Distrust grows; trusted people, TRUST.';

  it('finds whole words only, case-insensitively by default', () => {
    const hits = findOccurrences(text, { phrases: ['trust'], matchCase: false, wholeWords: true });
    expect(slices(text, hits)).toEqual(['Trust', 'TRUST']);
  });

  it('respects case and * as any letters within a word', () => {
    expect(slices(text, findOccurrences(text, { phrases: ['trust*'], matchCase: true, wholeWords: true }))).toEqual(['trusted']);
    expect(slices(text, findOccurrences(text, { phrases: ['*trust'], matchCase: false, wholeWords: true }))).toEqual(['Trust', 'Distrust', 'TRUST']);
  });

  it('lets whitespace in a phrase match any whitespace', () => {
    const t = 'bird is\nthe   word';
    expect(slices(t, findOccurrences(t, { phrases: ['bird is the word'], matchCase: false, wholeWords: true }))).toEqual(['bird is\nthe   word']);
  });
});

describe('paragraphs', () => {
  const text = 'Interviewer: Hi.\nParticipant: Hello.\n\nInterviewer: Bye.\nParticipant: Ciao.';

  it('ends paragraphs at line breaks or at empty lines', () => {
    expect(slices(text, paragraphs(text, { paragraphBreak: 'line', separators: [] }))).toHaveLength(4);
    expect(slices(text, paragraphs(text, { paragraphBreak: 'blank', separators: [] }))).toEqual([
      'Interviewer: Hi.\nParticipant: Hello.',
      'Interviewer: Bye.\nParticipant: Ciao.',
    ]);
  });

  it('starts a paragraph at each custom separator, which belongs to it', () => {
    expect(slices(text, paragraphs(text, { paragraphBreak: 'custom', separators: ['Interviewer:'] }))).toEqual([
      'Interviewer: Hi.\nParticipant: Hello.',
      'Interviewer: Bye.\nParticipant: Ciao.',
    ]);
  });
});
