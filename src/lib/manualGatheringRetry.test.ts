/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearAllManualGatheringRetryStates,
  clearManualGatheringRetryState,
  readManualGatheringRetryState,
  writeManualGatheringRetryState,
} from './manualGatheringRetry';

const userA = '10000000-0000-4000-8000-000000000001';
const userB = '10000000-0000-4000-8000-000000000002';
const familyA = '20000000-0000-4000-8000-000000000001';
const familyB = '20000000-0000-4000-8000-000000000002';
const retryKey = '30000000-0000-4000-8000-000000000001';

function onlyStoredKey(): string {
  expect(window.sessionStorage).toHaveLength(1);
  const storageKey = window.sessionStorage.key(0);
  expect(storageKey).toBeTruthy();
  return storageKey!;
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => window.sessionStorage.clear());

describe('manual gathering uncertain-retry storage', () => {
  it('stores only the validated uncertainty token and isolates it by user and family', () => {
    expect(writeManualGatheringRetryState(userA, familyA, retryKey)).toBe(true);

    expect(readManualGatheringRetryState(userA, familyA)).toEqual({
      version: 1,
      idempotencyKey: retryKey,
      uncertainCreateOutcome: true,
    });
    expect(readManualGatheringRetryState(userB, familyA)).toBeNull();
    expect(readManualGatheringRetryState(userA, familyB)).toBeNull();
    expect(JSON.parse(window.sessionStorage.getItem(onlyStoredKey())!)).toEqual({
      version: 1,
      idempotencyKey: retryKey,
      uncertainCreateOutcome: true,
    });
  });

  it.each([
    ['malformed JSON', '{not-json'],
    ['an invalid short key', JSON.stringify({ version: 1, idempotencyKey: 'short', uncertainCreateOutcome: true })],
    ['a certain outcome', JSON.stringify({ version: 1, idempotencyKey: retryKey, uncertainCreateOutcome: false })],
    ['an unexpected private-link field', JSON.stringify({
      version: 1,
      idempotencyKey: retryKey,
      uncertainCreateOutcome: true,
      shareUrl: 'https://example.test/private/invitation',
    })],
  ])('rejects and removes %s', (_label, malformedState) => {
    expect(writeManualGatheringRetryState(userA, familyA, retryKey)).toBe(true);
    const storageKey = onlyStoredKey();
    window.sessionStorage.setItem(storageKey, malformedState);

    expect(readManualGatheringRetryState(userA, familyA)).toBeNull();
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  });

  it('rejects invalid scope identifiers and idempotency keys', () => {
    expect(writeManualGatheringRetryState('bad:user', familyA, retryKey)).toBe(false);
    expect(writeManualGatheringRetryState(userA, '../family', retryKey)).toBe(false);
    expect(writeManualGatheringRetryState(userA, familyA, 'javascript:alert(1)')).toBe(false);
    expect(window.sessionStorage).toHaveLength(0);
  });

  it('clears one scope or all retry scopes without deleting unrelated session state', () => {
    expect(writeManualGatheringRetryState(userA, familyA, retryKey)).toBe(true);
    expect(writeManualGatheringRetryState(userB, familyB, `${retryKey}-second`)).toBe(true);
    window.sessionStorage.setItem('unrelated-session-state', 'keep');

    clearManualGatheringRetryState(userA, familyA);
    expect(readManualGatheringRetryState(userA, familyA)).toBeNull();
    expect(readManualGatheringRetryState(userB, familyB)?.idempotencyKey).toBe(`${retryKey}-second`);

    clearAllManualGatheringRetryStates();
    expect(readManualGatheringRetryState(userB, familyB)).toBeNull();
    expect(window.sessionStorage.getItem('unrelated-session-state')).toBe('keep');
  });
});
