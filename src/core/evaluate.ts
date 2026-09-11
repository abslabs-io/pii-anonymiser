import { anonymise, type Anonymised } from './anonymise';
import type { Fixture } from './samples';

export type Score = {
  expected: number;
  detected: number;
  correct: number;
  missed: number;
  extra: number;
};

export function scoreFixture(fixture: Fixture, result: Anonymised): Score {
  const expected = anonymise(fixture.text, fixture.expected).spans;
  const correct = result.spans.filter((span) =>
    expected.some(
      (target) =>
        target.start === span.start &&
        target.end === span.end &&
        target.category === span.category,
    ),
  ).length;
  return {
    expected: expected.length,
    detected: result.spans.length,
    correct,
    missed: expected.length - correct,
    extra: result.spans.length - correct,
  };
}
