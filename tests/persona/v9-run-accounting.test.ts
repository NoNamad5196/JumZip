import { describe, expect, it } from 'vitest';
import { summarizeMicroProgress } from './v9-run-accounting.ts';

describe('micro request accounting distinguishes pre-send blocks from real attempts', () => {
  it('keeps the last budget-blocked case pending and outside attempted/completed IDs', () => {
    expect(summarizeMicroProgress(['valid', 'invalid', 'blocked'], [
      { id: 'valid', actualHTTPAttempts: 1, completionStatus: 'VALID' },
      { id: 'invalid', actualHTTPAttempts: 2, completionStatus: 'INVALID' },
    ])).toEqual({ attemptedIds: ['valid', 'invalid'], completedIds: ['valid', 'invalid'], pendingIds: ['blocked'], neverAttemptedIds: ['blocked'] });
  });
  it('keeps a blocked repair pending while retaining its actual initial attempt', () => {
    expect(summarizeMicroProgress(['repair-blocked', 'later'], [{ id: 'repair-blocked', actualHTTPAttempts: 1, completionStatus: 'INTERRUPTED' }]))
      .toEqual({ attemptedIds: ['repair-blocked'], completedIds: [], pendingIds: ['repair-blocked', 'later'], neverAttemptedIds: ['later'] });
  });
  it('does not mistake a local preparation record for actual provider work', () => {
    expect(summarizeMicroProgress(['blocked'], [{ id: 'blocked', actualHTTPAttempts: 0, completionStatus: 'INVALID' }]))
      .toEqual({ attemptedIds: [], completedIds: [], pendingIds: ['blocked'], neverAttemptedIds: ['blocked'] });
  });
  it('marks a fully attempted invalid case complete only as execution, never quality', () => {
    expect(summarizeMicroProgress(['bad'], [{ id: 'bad', actualHTTPAttempts: 2, completionStatus: 'INVALID' }]))
      .toEqual({ attemptedIds: ['bad'], completedIds: ['bad'], pendingIds: [], neverAttemptedIds: [] });
  });
});
