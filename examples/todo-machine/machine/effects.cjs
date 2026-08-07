// Effect mapper for the todo machine — pure, edge-triggered. The durable
// timer replaces the classic "cron job scans the table for overdue items"
// loop: each item schedules its own DUE_PASSED, and staleness is handled by
// the machine (the timer's dueAt must match the item's current dueAt), so
// superseded timers need no cancellation races.
'use strict';

module.exports.effects = function effects(pre, action, data, post, stepKind) {
  if (stepKind !== 'accepted') return [];
  const entered = (s) => pre.todoState !== s && post.todoState === s;
  const out = [];

  // A (re)scheduled due date arms a durable timer carrying that exact date;
  // the machine rejects the firing if dueAt has moved on by then.
  if (post.dueAt !== pre.dueAt && post.dueAt !== '') {
    out.push({
      kind: 'timer',
      key: `due:${post.dueAt}`,
      fireAt: Date.parse(post.dueAt),
      action: 'DUE_PASSED',
      data: { dueAt: post.dueAt },
    });
  }

  if (entered('overdue')) {
    out.push({ kind: 'notifyUser', payload: { dueAt: post.dueAt, snoozeCount: post.snoozeCount } });
  }

  // The optional fuzzy middle: when the snooze budget is exhausted, ask a
  // model to SUGGEST a triage. The suggestion comes back to the app (not the
  // machine); a human — or the app acting on the suggestion — dispatches the
  // ordinary COMPLETE or DROP. The model proposes; the verified machine
  // disposes.
  if (entered('needsTriage')) {
    out.push({ kind: 'suggestTriage', payload: { snoozeCount: post.snoozeCount } });
  }

  return out;
};
