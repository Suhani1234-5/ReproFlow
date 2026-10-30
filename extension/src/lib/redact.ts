export const REDACTED = '[REDACTED]';

export interface FieldHints {
  type?: string;
  name?: string;
  id?: string;
  autocomplete?: string;
}

const SENSITIVE_FIELD =
  /pass(word|wd)?|pwd|secret|token|otp|one-?time|pin|cvv|cvc|card|credit|ssn|api[-_]?key|auth/i;

const TOKEN_VALUE =
  /(?:gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,})/;

const CARD_CANDIDATE = /\d(?:[ -]?\d){12,18}/g;

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = digits.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Password inputs and token-like field names are never recorded. */
export function isSensitiveField(hints: FieldHints): boolean {
  if (hints.type === 'password') return true;
  if (hints.autocomplete === 'current-password' || hints.autocomplete === 'new-password') return true;
  return SENSITIVE_FIELD.test(`${hints.name ?? ''} ${hints.id ?? ''} ${hints.autocomplete ?? ''}`);
}

/** Replaces token and card-number patterns anywhere in a string. */
export function redactText(input: string): string {
  const withoutTokens = input.replace(TOKEN_VALUE, REDACTED);
  return withoutTokens.replace(CARD_CANDIDATE, (match) => {
    const digits = match.replace(/[ -]/g, '');
    return luhn(digits) ? REDACTED : match;
  });
}

export function redactValue(value: string, hints: FieldHints): { value: string; redacted: boolean } {
  if (isSensitiveField(hints)) return { value: REDACTED, redacted: true };
  const redacted = redactText(value);
  return { value: redacted, redacted: redacted !== value };
}
