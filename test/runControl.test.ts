import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { controlRun } from '../lib/services/run.service.ts';

/**
 * The transition table, not the queue plumbing.
 *
 * The failure this pins down: an in-flight job finishing AFTER a stop and
 * finalizing the run back to 'completed', which would erase the fact that
 * someone stopped it. finalizeRun treats 'cancelled' as terminal for that
 * reason; these check the guards that get it there.
 */

function fakeQueue() {
  const calls: string[] = [];
  return {
    calls,
    pause: async () => { calls.push('pause'); },
    resume: async () => { calls.push('resume'); },
    drain: async () => { calls.push('drain'); },
    getWaitingCount: async () => 7,
    getDelayedCount: async () => 1,
    getActiveCount: async () => 3,
  };
}

function fakePrisma(status: string) {
  const writes: Array<Record<string, unknown>> = [];
  return {
    writes,
    auditRun: {
      findUnique: async () => ({ id: 'r1', status, completedJobs: 40, totalJobs: 100 }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        return { id: 'r1', ...data };
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('run control', () => {
  test('pausing holds the queue and counts what is still in flight', async () => {
    const q = fakeQueue();
    const db = fakePrisma('running');
    const r = await controlRun(db, 'r1', 'pause', q);

    assert.equal(r.status, 'paused');
    // Waiting + delayed: a job serving out a retry backoff has not been done.
    assert.equal(r.pending, 8);
    assert.equal(r.inFlight, 3);
    assert.deepEqual(q.calls, ['pause']);
    assert.equal(db.writes[0].status, 'paused');
  });

  test('resuming marks the run running BEFORE unpausing the queue', async () => {
    const q = fakeQueue();
    const db = fakePrisma('paused');
    await controlRun(db, 'r1', 'resume', q);

    // Order is load-bearing: unpause first and a job can finish and try to
    // finalize a run the database still calls paused.
    assert.equal(db.writes[0].status, 'running');
    assert.deepEqual(q.calls, ['resume']);
  });

  test('stopping drains before it unpauses, so the next run is not blocked', async () => {
    const q = fakeQueue();
    const db = fakePrisma('paused');
    const r = await controlRun(db, 'r1', 'stop', q);

    assert.equal(r.status, 'cancelled');
    assert.deepEqual(q.calls, ['drain', 'resume']);
    assert.equal(db.writes[0].status, 'cancelled');
    // Cancelled is not failed: the message has to say the results were kept.
    assert.match(String(db.writes[0].error), /kept/);
    assert.ok(db.writes[0].finishedAt instanceof Date);
  });

  test('a finished run cannot be paused, resumed or stopped', async () => {
    for (const [status, action] of [
      ['completed', 'pause'],
      ['completed', 'stop'],
      ['running', 'resume'],
      ['cancelled', 'stop'],
    ] as const) {
      await assert.rejects(
        () => controlRun(fakePrisma(status), 'r1', action, fakeQueue()),
        (e: Error) => e.message.includes(status),
        `${action} on a ${status} run should be refused`,
      );
    }
  });
});
