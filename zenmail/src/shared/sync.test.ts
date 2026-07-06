import { describe, expect, it } from 'vitest';
import { backoffDelayMs, classifyError, isExhausted, MAX_ATTEMPTS } from './sync';

describe('classifyError — TC-A1: coded transient errors', () => {
  it('classifies ECONNRESET as transient', () => {
    expect(classifyError({ code: 'ECONNRESET' })).toBe('transient');
  });

  it('classifies ENOTFOUND as transient', () => {
    expect(classifyError({ code: 'ENOTFOUND' })).toBe('transient');
  });

  it('classifies ETIMEDOUT as transient', () => {
    expect(classifyError({ code: 'ETIMEDOUT' })).toBe('transient');
  });

  it('classifies EAI_AGAIN, ECONNREFUSED, ENETUNREACH, EPIPE as transient', () => {
    expect(classifyError({ code: 'EAI_AGAIN' })).toBe('transient');
    expect(classifyError({ code: 'ECONNREFUSED' })).toBe('transient');
    expect(classifyError({ code: 'ENETUNREACH' })).toBe('transient');
    expect(classifyError({ code: 'EPIPE' })).toBe('transient');
  });

  it('classifies HTTP 5xx/429/408 status as transient', () => {
    expect(classifyError({ status: 500 })).toBe('transient');
    expect(classifyError({ status: 503 })).toBe('transient');
    expect(classifyError({ status: 429 })).toBe('transient');
    expect(classifyError({ status: 408 })).toBe('transient');
  });
});

describe('classifyError — TC-A2: permanent (fail-safe default)', () => {
  it('classifies 400 as permanent', () => {
    expect(classifyError({ status: 400 })).toBe('permanent');
  });

  it('classifies 404 as permanent', () => {
    expect(classifyError({ status: 404 })).toBe('permanent');
  });

  it('classifies a generic Error with no code/status as permanent (fail-safe)', () => {
    expect(classifyError(new Error('injected failure'))).toBe('permanent');
  });

  it('classifies null/undefined/non-object as permanent', () => {
    expect(classifyError(null)).toBe('permanent');
    expect(classifyError(undefined)).toBe('permanent');
    expect(classifyError('boom')).toBe('permanent');
  });
});

describe('backoffDelayMs / isExhausted — TC-A3: exponential, cap, exhaustion', () => {
  it('doubles per attempt starting from base 10s', () => {
    expect(backoffDelayMs(1)).toBe(10_000);
    expect(backoffDelayMs(2)).toBe(20_000);
    expect(backoffDelayMs(3)).toBe(40_000);
    expect(backoffDelayMs(4)).toBe(80_000);
  });

  it('caps at 900_000ms', () => {
    expect(backoffDelayMs(7)).toBe(640_000);
    expect(backoffDelayMs(8)).toBe(900_000);
    expect(backoffDelayMs(20)).toBe(900_000);
  });

  it('applies an injected jitter factor without calling Math.random itself', () => {
    expect(backoffDelayMs(1, 0.2)).toBe(12_000);
    expect(backoffDelayMs(1, -0.2)).toBe(8_000);
  });

  it('MAX_ATTEMPTS is 8 and isExhausted reflects it', () => {
    expect(MAX_ATTEMPTS).toBe(8);
    expect(isExhausted(7)).toBe(false);
    expect(isExhausted(8)).toBe(true);
    expect(isExhausted(9)).toBe(true);
  });
});
