const TERMINAL = ['completed', 'archived'];
const STATES = ['open', 'overdue', 'needsTriage', 'completed', 'archived'];

const same = (a, b) =>
  a.todoState === b.todoState &&
  a.snoozeCount === b.snoozeCount &&
  a.dueAt === b.dueAt &&
  a.doneVia === b.doneVia;

const nonEmpty = (v) => typeof v === 'string' && v.length > 0;

export const stateInvariants = [
  {
    // Shape of every reachable state: legal state name, budget kept in 0..2.
    name: 'state-name-and-snooze-budget-in-range',
    pred: (s) =>
      STATES.includes(s.todoState) &&
      typeof s.snoozeCount === 'number' &&
      Number.isInteger(s.snoozeCount) &&
      s.snoozeCount >= 0 &&
      s.snoozeCount <= 2,
  },
  {
    // dueAt discipline: overdue always carries a concrete due date; needsTriage
    // and both terminals never carry one.
    name: 'due-at-consistent-with-state',
    pred: (s) => {
      if (s.todoState === 'overdue') return nonEmpty(s.dueAt);
      if (
        s.todoState === 'needsTriage' ||
        s.todoState === 'completed' ||
        s.todoState === 'archived'
      ) {
        return s.dueAt === '';
      }
      return typeof s.dueAt === 'string';
    },
  },
  {
    // Outcome is recorded exactly in the terminals and nowhere else.
    name: 'done-via-recorded-only-in-terminals',
    pred: (s) => {
      if (s.todoState === 'completed') return s.doneVia === 'completed';
      if (s.todoState === 'archived') return nonEmpty(s.doneVia);
      return s.doneVia === '';
    },
  },
];

export const transitionInvariants = [
  {
    // reopen-is-a-new-instance: completed / archived are frozen — no action
    // may change any field of a settled item.
    name: 'terminal-states-are-frozen',
    pred: (pre, action, data, post) =>
      !TERMINAL.includes(pre.todoState) || same(pre, post),
  },
  {
    // stale-due-timer-reject: DUE_PASSED fires only in open for the exact
    // current dueAt (then -> overdue, dueAt kept); anything else is a no-op.
    name: 'due-passed-only-matching-timer-in-open',
    pred: (pre, action, data, post) => {
      if (action !== 'DUE_PASSED') return true;
      const d = data || {};
      const applies =
        pre.todoState === 'open' &&
        nonEmpty(pre.dueAt) &&
        nonEmpty(d.dueAt) &&
        d.dueAt === pre.dueAt;
      if (!applies) return same(pre, post);
      return (
        post.todoState === 'overdue' &&
        post.dueAt === pre.dueAt &&
        post.snoozeCount === pre.snoozeCount &&
        post.doneVia === pre.doneVia
      );
    },
  },
  {
    // corrections-are-event-driven: the only backward edge is overdue -> open,
    // taken only by SNOOZE under budget, with data.until recorded verbatim
    // and snoozeCount bumped by exactly 1.
    name: 'only-backward-edge-is-under-budget-snooze',
    pred: (pre, action, data, post) => {
      if (post.todoState === pre.todoState) return true;
      if (post.todoState !== 'open') return true;
      const d = data || {};
      return (
        action === 'SNOOZE' &&
        pre.todoState === 'overdue' &&
        pre.snoozeCount < 2 &&
        nonEmpty(d.until) &&
        post.dueAt === d.until &&
        post.snoozeCount === pre.snoozeCount + 1 &&
        post.doneVia === pre.doneVia
      );
    },
  },
  {
    // snoozeCount moves only by exactly +1, and only on an accepted SNOOZE
    // taken in overdue while under budget (which must land in open).
    name: 'snooze-count-moves-only-by-one-under-budget-snooze',
    pred: (pre, action, data, post) => {
      if (post.snoozeCount === pre.snoozeCount) return true;
      const d = data || {};
      return (
        action === 'SNOOZE' &&
        pre.todoState === 'overdue' &&
        pre.snoozeCount < 2 &&
        nonEmpty(d.until) &&
        post.snoozeCount === pre.snoozeCount + 1 &&
        post.todoState === 'open'
      );
    },
  },
  {
    // bounded-snooze-budget-triages: SNOOZE at the budget goes to needsTriage
    // (dueAt cleared, count unchanged); needsTriage never accepts SNOOZE.
    name: 'exhausted-budget-snooze-triages',
    pred: (pre, action, data, post) => {
      if (action !== 'SNOOZE') return true;
      if (pre.todoState === 'needsTriage') return same(pre, post);
      const d = data || {};
      if (pre.todoState !== 'overdue' || !nonEmpty(d.until)) {
        return TERMINAL.includes(pre.todoState) || same(pre, post);
      }
      if (pre.snoozeCount < 2) return true;
      return (
        post.todoState === 'needsTriage' &&
        post.dueAt === '' &&
        post.snoozeCount === pre.snoozeCount &&
        post.doneVia === pre.doneVia
      );
    },
  },
  {
    // COMPLETE / DROP settle an active item exactly once, with the outcome and
    // a cleared dueAt; no other action may reach a terminal state.
    name: 'terminals-only-via-complete-or-drop',
    pred: (pre, action, data, post) => {
      if (!TERMINAL.includes(post.todoState) || TERMINAL.includes(pre.todoState)) {
        return !TERMINAL.includes(post.todoState) || TERMINAL.includes(pre.todoState);
      }
      const d = data || {};
      const active = ['open', 'overdue', 'needsTriage'].includes(pre.todoState);
      if (!active) return false;
      if (action === 'COMPLETE') {
        return (
          post.todoState === 'completed' &&
          post.doneVia === 'completed' &&
          post.dueAt === '' &&
          post.snoozeCount === pre.snoozeCount
        );
      }
      if (action === 'DROP') {
        return (
          post.todoState === 'archived' &&
          nonEmpty(d.reason) &&
          post.doneVia === d.reason &&
          post.dueAt === '' &&
          post.snoozeCount === pre.snoozeCount
        );
      }
      return false;
    },
  },
];