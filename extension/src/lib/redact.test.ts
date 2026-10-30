import { describe, expect, it } from 'vitest';
import { REDACTED, isSensitiveField, redactText, redactValue } from './redact';

describe('isSensitiveField', () => {
  it('flags password inputs', () => {
    expect(isSensitiveField({ type: 'password' })).toBe(true);
  });

  it('flags token-like field names', () => {
    expect(isSensitiveField({ name: 'accessToken' })).toBe(true);
    expect(isSensitiveField({ id: 'card-number' })).toBe(true);
    expect(isSensitiveField({ autocomplete: 'new-password' })).toBe(true);
  });

  it('leaves ordinary fields alone', () => {
    expect(isSensitiveField({ type: 'text', name: 'email' })).toBe(false);
  });
});

describe('redactValue', () => {
  it('masks every password value regardless of content', () => {
    expect(redactValue('hunter2', { type: 'password' })).toEqual({ value: REDACTED, redacted: true });
  });

  it('masks bearer tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQ';
    expect(redactValue(jwt, {}).value).toBe(REDACTED);
  });

  it('masks card numbers that pass the Luhn check', () => {
    expect(redactValue('4111 1111 1111 1111', {}).value).toBe(REDACTED);
  });

  it('keeps non-card digit runs', () => {
    expect(redactValue('order 1234 5678 9012 3456', {}).value).toBe('order 1234 5678 9012 3456');
  });

  it('keeps ordinary text untouched', () => {
    expect(redactValue('hello@example.com', { name: 'email' })).toEqual({
      value: 'hello@example.com',
      redacted: false,
    });
  });
});

describe('redactText', () => {
  it('redacts a token embedded in a longer message', () => {
    const token = 'ghp_abcdefghijklmnopqrstuvwxyz01';
    expect(redactText(`request failed with ${token}`)).toBe(`request failed with ${REDACTED}`);
  });

  it('keeps plain sentences unchanged', () => {
    expect(redactText('TypeError: x is not a function')).toBe('TypeError: x is not a function');
  });
});
