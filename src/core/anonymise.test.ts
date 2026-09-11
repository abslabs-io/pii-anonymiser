import { describe, expect, it } from 'vitest';
import {
  anonymise,
  DetectionError,
  parseEntities,
  type Entity,
} from './anonymise';
import { fixtures } from './samples';
import { scoreFixture } from './evaluate';

describe('exact-span replacement', () => {
  it('preserves punctuation, tabs, CRLF, Unicode and trailing whitespace', () => {
    const original = '👋\tAlice!\r\n\r\nEmail: alice@example.com.  \n';
    const result = anonymise(original, [
      { text: 'Alice', category: 'PERSON' },
      { text: 'alice@example.com', category: 'EMAIL' },
    ]);
    expect(result.output).toBe('👋\t[PERSON_1]!\r\n\r\nEmail: [EMAIL_1].  \n');
    expect(result.spans[0].start).toBe(3);
  });

  it('reuses tokens, ignores duplicates and numbers by order of appearance', () => {
    const result = anonymise('Alice met Bob. Alice emailed Bob.', [
      { text: 'Bob', category: 'PERSON' },
      { text: 'Alice', category: 'PERSON' },
      { text: 'Alice', category: 'PERSON' },
    ]);
    expect(result.output).toBe(
      '[PERSON_1] met [PERSON_2]. [PERSON_1] emailed [PERSON_2].',
    );
  });

  it('does not replace substrings within larger Unicode words', () => {
    expect(
      anonymise('Ann Anna Annette éAnn Année Ann.', [
        { text: 'Ann', category: 'PERSON' },
      ]).output,
    ).toBe('[PERSON_1] Anna Annette éAnn Année [PERSON_1].');
  });

  it('prefers complete containing spans and rejects partial overlaps', () => {
    expect(
      anonymise('Alice Morgan', [
        { text: 'Alice', category: 'PERSON' },
        { text: 'Alice Morgan', category: 'PERSON' },
      ]).output,
    ).toBe('[PERSON_1]');
    expect(() =>
      anonymise('Alice Morgan Reed', [
        { text: 'Alice Morgan', category: 'PERSON' },
        { text: 'Morgan Reed', category: 'PERSON' },
      ]),
    ).toThrow(DetectionError);
  });

  it('does not collide with existing placeholder text', () => {
    expect(
      anonymise('[PERSON_1] and Alice and [PERSON_2]', [
        { text: 'Alice', category: 'PERSON' },
      ]).output,
    ).toBe('[PERSON_1] and [PERSON_3] and [PERSON_2]');
  });

  it('rejects invented text, normalised text, partial words, and conflicting labels', () => {
    for (const entities of [
      [{ text: 'Bob', category: 'PERSON' }],
      [{ text: 'alice', category: 'PERSON' }],
      [{ text: 'Ali', category: 'PERSON' }],
      [{ text: '', category: 'PERSON' }],
      [
        { text: 'Alice', category: 'PERSON' },
        { text: 'Alice', category: 'ADDRESS' },
      ],
    ] as Entity[][])
      expect(() => anonymise('Alice', entities)).toThrow(DetectionError);
  });

  it('returns the original unchanged when no entities are detected', () => {
    expect(
      anonymise(' \r\nSafe <script>alert(1)</script> text.\t', []).output,
    ).toBe(' \r\nSafe <script>alert(1)</script> text.\t');
  });

  it.each(fixtures)(
    'round-trips every original character in $name',
    (fixture) => {
      const result = anonymise(fixture.text, fixture.expected);
      let restored = result.output;
      for (const [token, text] of new Map(
        result.spans.map((span) => [span.token, span.text]),
      )) {
        restored = restored.replaceAll(token, text);
      }
      expect(restored).toBe(fixture.text);
      let sourceCursor = 0;
      let outputCursor = 0;
      for (const span of result.spans) {
        const untouched = fixture.text.slice(sourceCursor, span.start);
        expect(
          result.output.slice(outputCursor, outputCursor + untouched.length),
        ).toBe(untouched);
        outputCursor += untouched.length + span.token.length;
        sourceCursor = span.end;
      }
      expect(result.output.slice(outputCursor)).toBe(
        fixture.text.slice(sourceCursor),
      );
    },
  );
});

describe('model output validation', () => {
  it.each([
    'not json',
    '{}',
    'null',
    '[]',
    '{"entities":null}',
    '{"entities":[{"text":"Alice","category":"CITY"}]}',
    '{"entities":[{"text":" ","category":"PERSON"}]}',
  ])('rejects invalid response %s', (raw) => {
    expect(() => parseEntities(raw)).toThrow(DetectionError);
  });
  it('accepts an empty extraction and a valid entity', () => {
    expect(parseEntities('{"entities":[]}')).toEqual([]);
    expect(
      parseEntities('{"entities":[{"text":"Alice","category":"PERSON"}]}'),
    ).toEqual([{ text: 'Alice', category: 'PERSON' }]);
  });
});

it('evaluation counts exact spans and category errors, including repeated occurrences', () => {
  const fixture = fixtures[0];
  const result = anonymise(fixture.text, [
    { text: 'Alice Morgan', category: 'ADDRESS' },
  ]);
  expect(scoreFixture(fixture, result)).toEqual({
    expected: 4,
    detected: 2,
    correct: 0,
    missed: 4,
    extra: 2,
  });
});
