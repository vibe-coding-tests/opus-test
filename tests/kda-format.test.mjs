import test from 'node:test';
import assert from 'node:assert/strict';

import { fmtKDA } from '../src/utils.js';

test('fmtKDA includes assists and protects zero-death players', () => {
  assert.equal(fmtKDA({ kills: 7, assists: 3, deaths: 0 }), '10.00');
  assert.equal(fmtKDA({ kills: 7, assists: 3, deaths: 5 }), '2.00');
});
