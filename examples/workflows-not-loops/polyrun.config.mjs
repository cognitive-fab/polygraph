// polyrun config for the workflows-not-loops document pipeline:
//   node polyrun/bin/polyrun.mjs deploy        --config examples/workflows-not-loops/polyrun.config.mjs
//   node polyrun/bin/polyrun.mjs check-effects --config examples/workflows-not-loops/polyrun.config.mjs
// PIPELINE_VERSION=pipeline-v2 selects the v2 artifacts (the lint-gate
// version); default is pipeline-v1. The demo (demo/run-demo.mjs) registers
// its own file-backed handlers; the handlers here are the minimal set so
// deploy/check can load the config.
'use strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const v = process.env.PIPELINE_VERSION === 'pipeline-v2' ? 'pipeline-v2' : 'pipeline-v1';

export default {
  store: process.env.POLYRUN_PG_URL
    ? { postgres: process.env.POLYRUN_PG_URL }
    : { sqlite: 'demo/.demo-state/pipeline.sqlite' },
  machines: [{
    machineId: 'docpipe',
    module: `${v}/next.cjs`,
    contract: `${v}/contract.json`,
    effects: { mapper: `${v}/effects.cjs`, manifest: `${v}/effects.manifest.json` },
    invariants: `${v}/invariants.mjs`,
    effectInvariants: `${v}/effect-invariants.mjs`,
    ...(v === 'pipeline-v2' ? { migrate: 'pipeline-v2/migrate.cjs' } : {}),
  }],
  handlers: {
    extract: async () => { await sleep(50); return {}; },
    transform: async () => { await sleep(50); return {}; },
    validate: async () => { await sleep(50); return {}; },
    lint: async () => { await sleep(50); return {}; },
    render: async () => { await sleep(50); return {}; },
  },
  worker: { leaseMs: 4000 },
  poll: { effectPollMs: 100, timerPollMs: 100 },
};
