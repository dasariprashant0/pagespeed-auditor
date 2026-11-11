import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../lib/report/csv.ts';

test('toCsv quotes, escapes and neutralises formulas', () => {
  assert.equal(
    toCsv(['a', 'b', 'c'], [['x,y', 'say "hi"', null], [1, '=SUM(A1)', -2]]),
    'a,b,c\r\n"x,y","say ""hi""",\r\n1,\'=SUM(A1),-2\r\n',
  );
});
