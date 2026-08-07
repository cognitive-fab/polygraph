// Effect mapper for the document pipeline — pure, edge-triggered on state
// transitions. This is the article's "push determinism to the edges" drawn as
// a line in code: the machine decides, the mapper declares, the handlers (the
// deterministic edges plus one fuzzy model step) perform.
//
// The targeted-fix payload is the point: when validation bends the pipeline
// back, the transform stage receives the EXACT violation — "fix this" — not a
// re-plan of the whole job.
'use strict';

module.exports.effects = function effects(pre, action, data, post, stepKind) {
  if (stepKind !== 'accepted') return [];
  const entered = (s) => pre.docState !== s && post.docState === s;
  const out = [];

  if (entered('extracting')) {
    out.push({ kind: 'extract', payload: {} });
  }
  if (entered('transforming')) {
    out.push({
      kind: 'transform',
      payload: { fixPass: post.fixAttempts > 0, violation: post.lastViolation },
    });
  }
  if (entered('validating')) {
    out.push({ kind: 'validate', payload: {} });
  }
  if (entered('linting')) {
    out.push({ kind: 'lint', payload: {} });
  }
  if (entered('rendering')) {
    out.push({ kind: 'render', payload: {} });
  }
  return out;
};
