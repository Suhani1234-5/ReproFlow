import { describe, expect, it } from 'vitest';
import type { RawEvent } from '@shared/types';
import { recoverNextSeq, sortBySeq, withSeq } from './events';

const click = (id: string, ts: number): RawEvent => ({
  type: 'click',
  id,
  ts,
  url: 'https://app.test/checkout',
  selector: '#pay',
});

const fill = (id: string, ts: number): RawEvent => ({
  type: 'fill',
  id,
  ts,
  url: 'https://app.test/checkout',
  selector: '#card',
  value: '[REDACTED]',
  redacted: true,
});

describe('withSeq', () => {
  it('numbers a batch from the given start', () => {
    const rows = withSeq('s1', [click('a', 1), fill('b', 2)], 0);
    expect(rows.map((row) => row.seq)).toEqual([0, 1]);
    expect(rows.every((row) => row.sessionId === 's1')).toBe(true);
  });

  it('keeps arrival order across separate batches', () => {
    const first = withSeq('s1', [click('a', 1), fill('b', 2)], 0);
    const second = withSeq('s1', [click('c', 3)], first.length);
    expect(sortBySeq([...second, ...first]).map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('recoverNextSeq', () => {
  it('starts at zero for an empty session', () => {
    expect(recoverNextSeq([])).toBe(0);
  });

  it('continues after the highest stored sequence', () => {
    const stored = withSeq('s1', [click('a', 1), fill('b', 2), click('c', 3)], 0);
    expect(recoverNextSeq(stored)).toBe(3);
  });

  it('does not reorder events captured across a worker restart', () => {
    const before = withSeq('s1', [click('a', 1), fill('b', 2)], 0);
    const after = withSeq('s1', [click('c', 3)], recoverNextSeq(before));
    const persisted = [...after, ...before];
    expect(sortBySeq(persisted).map((row) => [row.seq, row.id])).toEqual([
      [0, 'a'],
      [1, 'b'],
      [2, 'c'],
    ]);
  });
});
