import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { markRead, markReading, readClear, readState, signRead, unlockRead } from '../readstatus.js';

describe('read status', () => {
  it('unread → reading → read → signed+locked → unlock → read', () => {
    readClear();
    assert.equal(readState('s').status, 'unread');
    assert.equal(markReading('s').status, 'reading');
    assert.equal(markReading('s').status, 'reading'); // idempotent
    assert.equal(signRead('s'), null); // must read first
    assert.equal(markRead('s')!.status, 'read');
    const signed = signRead('s', 'second');
    assert.equal(signed!.status, 'signed');
    assert.equal(signed!.locked, true);
    assert.equal(signed!.secondReader, 'second');
    assert.ok(signed!.signedAt);
    assert.equal(markReading('s').status, 'signed'); // locked: open doesn't regress
    assert.equal(markRead('s'), null); // locked: no transitions
    const un = unlockRead('s')!;
    assert.equal(un.locked, false);
    assert.equal(un.status, 'read');
    assert.equal(unlockRead('s'), null); // already unlocked
  });
});
