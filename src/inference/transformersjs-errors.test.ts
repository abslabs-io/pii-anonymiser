import { expect, it } from 'vitest';
import { explainTransformersJsError } from './transformersjs-errors';

it('explains a Transformers.js session memory allocation failure', () => {
  const detail =
    "Can't create a session. ERROR_CODE: 6, ERROR_MESSAGE: std::bad_alloc";

  const message = explainTransformersJsError(detail);

  expect(message).toContain('could not fit in the memory');
  expect(message).toContain('current Chrome or Edge');
  expect(message).toContain('use the 0.6B model');
  expect(message).toContain(`Technical detail: ${detail}`);
});

it.each([
  ['QuotaExceededError: storage quota exceeded', 'enough site storage'],
  ['GPU device was lost', 'lost access to the GPU'],
  ['TypeError: Failed to fetch', 'could not be downloaded'],
  ['buffer size exceeds maxBufferSize', 'exceeds a WebGPU limit'],
])('explains the known runtime failure %s', (detail, expected) => {
  const message = explainTransformersJsError(detail);

  expect(message).toContain(expected);
  expect(message).toContain(`Technical detail: ${detail}`);
});

it('preserves an unknown runtime error verbatim', () => {
  expect(explainTransformersJsError('Unexpected operator failure')).toBe(
    'Unexpected operator failure',
  );
});
