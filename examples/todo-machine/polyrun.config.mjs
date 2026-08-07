// polyrun config for the todo machine:
//   node polyrun/bin/polyrun.mjs deploy        --config examples/todo-machine/polyrun.config.mjs
//   node polyrun/bin/polyrun.mjs check-effects --config examples/todo-machine/polyrun.config.mjs
// The demo (demo/run-demo.mjs) registers its own handlers; these are the
// minimal set so deploy/check can load the config.
'use strict';

export default {
  store: process.env.POLYRUN_PG_URL
    ? { postgres: process.env.POLYRUN_PG_URL }
    : { sqlite: 'demo/.demo-state/todo.sqlite' },
  machines: [{
    machineId: 'todo',
    module: 'machine/next.cjs',
    contract: 'machine/contract.json',
    effects: { mapper: 'machine/effects.cjs', manifest: 'machine/effects.manifest.json' },
    invariants: 'machine/invariants.mjs',
    effectInvariants: 'machine/effect-invariants.mjs',
  }],
  handlers: {
    notifyUser: async () => ({}),
    suggestTriage: async () => ({ suggestion: 'drop' }),
  },
  worker: { leaseMs: 4000 },
  poll: { effectPollMs: 100, timerPollMs: 100 },
};
