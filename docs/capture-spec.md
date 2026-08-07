# The capture harness — specification

**Status:** design spec, not implemented. Implements item §1 of
[`capture-plan.md`](capture-plan.md).

Capture itself is not an open problem — `skills/polygraph/SKILL.md` Step 2
already assigns it to the agent and ships helpers for it. What is missing is
that the harness the agent writes is **disposable**: instrument a copy, keep
the change as a diff, produce a corpus, discard. That is correct for a one-off
audit and wrong for everything that has to happen twice.

This spec promotes the harness to a member of the artifact family, so a corpus
can be *re-derived* rather than merely *trusted*.

> Scope disclosure: this changes the strength of the **conformance** claim,
> never the coverage claim. "Exhaustive" remains exhaustive over the finite
> (action, data) domains the contract declares.

## 1. Why the current shape blocks three gates

**FR-1.1 — polygate cannot re-capture.** CI is keyless and deterministic by
design; it cannot spawn an agent to re-derive a shim per merge request. The
corpus in CI is therefore whatever was committed, with nothing establishing
that the harness which produced it still attaches to the code as it now
stands. A merge that moves the target and leaves the corpus untouched is
currently green.

**FR-1.2 — polyvers cannot replay stimuli honestly.** The in-flight stimuli
gate replays real action sequences against a new version. That presumes a
stable stimulus source. Today the provenance of the corpus behind that replay
is "an agent made it once."

**FR-1.3 — model-generated evidence feeds a deterministic gate.** A wrong shim
yields a healthy-looking corpus that certifies a wrong spec. This is Specula's
named reward-hacking failure mode arriving through a different door. Existing
defenses (`validate_corpus.mjs`, `mutate.mjs --all` zero-flip) check the
*corpus*; nothing checks the provenance of the thing that produced it.

## 2. Artifact layout

Follows the `effects.cjs` + `effects.manifest.json` precedent: a declarative
manifest at the version root carrying identity, and a payload directory.

```
<version-dir>/
  contract.json               # existing
  next.cjs                    # existing
  invariants.mjs              # existing
  capture.manifest.json       # NEW — identity, hashed, human-reviewable
  capture/                    # NEW — payload
    run.mjs                   #   entry point: emits the corpus, no model call
    instrument.patch          #   the diff applied to a copy of the target
    scenarios/*.mjs           #   one driver per scenario
  traces/*.ndjson             # existing — now a derived artifact
```

**FR-2.1** `capture/run.mjs` MUST be executable with no API key and no network
access to a model: `node capture/run.mjs --out traces/`.

**FR-2.2** `traces/` becomes a **derived** artifact. It stays committed (CI
must not need to run the target), but it is now reproducible from
`capture/` rather than being the root of trust.

## 3. `capture.manifest.json`

```jsonc
{
  "captureVersion": 1,
  "source": "committed-harness",       // §5 vocabulary
  "entry": "capture/run.mjs",
  "seam": {
    "kind": "sam-dispatch",            // sam-dispatch | dispatch-wrapper |
                                       // reducer-tap | event-subscription |
                                       // journal | adapter-process
    "helper": "withSamTracing",        // scripts/instrument/ helper, if used
    "notes": "wraps the component config; no-ops included"
  },
  "target": {
    "repo": "git@github.com:acme/checkout.git",
    "commit": "9f1c2ab…",
    "files": [                         // every file the patch touches
      { "path": "src/orderMachine.js", "sha256": "e3b0c442…" }
    ]
  },
  "projection": {
    "stateKeys": ["orderState", "charged", "shipState"],
    "redact": ["updatedAt", "requestId"]   // non-deterministic fields
  },
  "scenarios": [
    { "name": "happy-path",         "file": "capture/scenarios/happy.mjs",  "seed": 1 },
    { "name": "cancel-while-charging","file": "capture/scenarios/cancel.mjs","seed": 2 }
  ],
  "doubles": [
    { "name": "payment-terminal-emulator", "validatedAgainst": "sandbox", "date": "2026-07-30" }
  ],
  "payloadHash": "sha256:1a2b3c…"
}
```

**FR-3.1 — `payloadHash` is the Merkle root of `capture/`.** Computed as
`sha256` over the sorted list of `<relpath>\n<sha256>` lines for every file
under `capture/`. This deliberately sidesteps the single-file limitation
recorded at `polyvers/src/artifacts.mjs:9-12`: the manifest hashes a *tree*,
so a multi-file harness has a stable identity even though machine modules do
not yet.

**FR-3.2 — `projection.stateKeys` MUST equal `observableKeys(contract)`**
(`polyvers/src/artifacts.mjs:144`). A harness that captures a different
projection than the contract declares is a capture bug, and loading MUST fail
rather than warn.

**FR-3.3 — `redact` fields are removed before a window is emitted**, not
after. Redaction after the fact would let a non-deterministic field
participate in `stable()` equality inside the harness and produce chain breaks
the validator then reports as capture bugs.

**FR-3.4 — `doubles` is disclosure, not configuration.** SKILL.md Step 2 names
the correlated-oracle risk: a test double that silently diverges from the real
dependency makes every downstream verdict wrong in the same direction.
Recording which doubles exist, and whether any was validated against a real
service, puts that risk in the artifact instead of in the agent's memory.

## 4. Identity: capture is NOT part of `versionHash`

**FR-4.1** `loadArtifacts()` gains `captureHash` (the sha256 of
`capture.manifest.json`), and it MUST NOT enter `versionHash`.

Rationale, and this is a deliberate departure from how `migrate.cjs` is
treated. `migrate.cjs` *is* in `versionHash` because "shipping the same machine
with a different migration is a different version" — a migration changes
production state. A capture harness changes nothing that runs in production.
Folding it into version identity would make a harness edit fire compatibility
lanes in polyvers and demand a migration for a test-infrastructure change.

**FR-4.2** The concatenation in `artifacts.mjs:139` MUST remain
six-slot when no capture manifest is present, so every existing version keeps
its current `versionHash`. Appending an unconditional seventh `?? ''` slot
would add a trailing `\n` and silently re-identify every artifact directory in
existence.

## 5. Provenance vocabulary

Extends the "descending order of honesty" convention already established for
snapshots in `polyvers/src/corpus.mjs:3-10`.

| `source` | meaning | re-runnable | admissible as conformance evidence |
|---|---|---|---|
| `polyrun-journal` | byproduct of durable execution; atomic per FR-2.2 of the polyrun spec | n/a — it is the record | yes, strongest |
| `committed-harness` | this spec; re-derivable by CI | yes | yes |
| `agent-adhoc` | today's behavior: agent captured once, harness not committed | no | yes, labelled |
| `synthesized` | generated from a spec (polygen) | yes | **no** |

**FR-5.1** `synthesized` corpora MUST be rejected as conformance evidence.
Replaying a spec-derived corpus against that same spec is circular. This
already exists as doctrine — `skills/polygraph/SKILL.md:33` says *"Do not
substitute synthetic traces derived from the spec"* — and this field makes it
mechanically enforceable rather than an instruction a future agent may skip.
Synthesized corpora remain valid as **regression** corpora.

**FR-5.2** `agent-adhoc` MUST remain permitted. Existing users have no harness,
and the migration path is a label, not a break.

## 6. Three independent staleness relations

Conflating these is why "is the corpus stale?" has no single answer.

**FR-6.1 — target drift.** Any `target.files[].sha256` that no longer matches
the working tree ⇒ the patch may not apply and the seam may have moved.
Verdict: **fail**, naming the file. This is the check that closes FR-1.1.

**FR-6.2 — corpus/harness drift.** Each emitted `*.ndjson` carries a sidecar
`traces/<name>.meta.json` recording the `payloadHash` that produced it. A
mismatch against the current manifest ⇒ the corpus predates the harness.
Verdict: **fail**.

**FR-6.3 — corpus/contract drift.** A declared action, state or special rule
the corpus never exercises. Already mechanized by `validate_corpus.mjs` and
`mutate.mjs --all` zero-flip. Verdict: **warn**, except zero-flip which
already exits 1.

**FR-6.4** These MUST be reported separately. "Stale" without a relation is
unactionable.

## 7. Determinism gate

The property that makes a committed harness worth more than a committed
corpus: it can be **checked against itself**.

**FR-7.1** `capture verify` re-runs every scenario at its declared `seed` and
compares each window by `stable()` (`scripts/load-spec.mjs` — the single state
equality every consumer shares). Any divergence is a **harness defect**, not a
code finding, and MUST be reported as such.

**FR-7.2** A harness that emits zero windows MUST fail loudly. Precedent:
`artifacts.mjs:95` refuses to gate vacuously against a present-but-empty
invariants artifact. Same reasoning — a green run over an empty corpus is the
most dangerous output the system can produce.

**FR-7.3** Non-determinism that survives `projection.redact` MUST fail rather
than be tolerated with a retry. A harness that needs three runs to agree with
itself is not evidence.

## 8. CLI

Keyless and deterministic throughout. Only `init` is agent-assisted, and it
writes files rather than gating anything.

```
node scripts/capture.mjs init   --contract contract.json --target <path>
node scripts/capture.mjs run    --manifest capture.manifest.json --out traces/
node scripts/capture.mjs verify --manifest capture.manifest.json [--traces traces/]
node scripts/capture.mjs status --manifest capture.manifest.json
```

**FR-8.1** `run` MUST emit corpora that pass
`node scripts/validate_corpus.mjs <contract.json> <traces-dir>` unmodified, so
no downstream consumer — `replay.mjs`, `check.mjs`, polyvers — learns how a
window was produced.

**FR-8.2** `verify` is the CI entry point and MUST exit non-zero on any FR-6.1,
FR-6.2, FR-7.1, FR-7.2 or FR-7.3 failure.

**FR-8.3** `status` prints the three staleness relations and the provenance
tier without running the target — cheap enough for a pre-commit hook.

## 9. Reporting

**FR-9.1** The conformance section of any verdict gains:

```json
{
  "conformance": {
    "verdict": "faithful",
    "capture": { "source": "committed-harness", "payloadHash": "sha256:1a2b3c…" },
    "windows": 1284,
    "coverage": "41/58 declared (action,data) pairs exercised",
    "doubles": ["payment-terminal-emulator (validated: sandbox)"]
  }
}
```

**FR-9.2** polyvers `compat-report` MUST carry the capture provenance of the
stimulus corpus in the same place it already carries snapshot provenance
(`polyvers/src/report.mjs:25`). A compatibility PASS whose stimuli came from an
uncommitted harness is a weaker verdict and must read as one.

## 10. Skill changes

**FR-10.1** SKILL.md Step 2 gains a final instruction: having built the
harness, write `capture.manifest.json` and move the working files under
`capture/`. The agent already does the hard part; today it throws the result
away.

**FR-10.2** Step 2's "keep the change as a diff/patch" becomes
`capture/instrument.patch` at a named path.

**FR-10.3** When `capture.manifest.json` exists and `capture verify` passes,
the agent SHOULD skip re-instrumentation entirely and run the committed
harness. This is the payoff: the second audit of a codebase is cheap.

## 11. Non-goals

- **Not a runtime component.** The harness runs in CI and development. polyrun
  is what observes production, and its journal outranks any harness (§5).
- **Not multi-language yet.** V1 targets JS/TS via `scripts/instrument/`. The
  manifest's `seam.kind: adapter-process` reserves the subprocess-protocol
  extension for other languages; the protocol itself is out of scope here.
- **Not differential execution.** That is `capture-plan.md` §3 and depends on
  this spec's `run.mjs` exposing a drive path. Sequenced after.
- **Not concurrency-safe by itself.** Capture requires an observable
  serialization point (`capture-plan.md` §3). Under polyrun it exists by
  construction; elsewhere the harness inherits whatever the seam provides.

## 12. Open questions

1. **Patch rot.** `instrument.patch` against a moved target fails to apply.
   Is regeneration an agent task (`init --reuse`), or should the seam be
   expressed declaratively (module + export + projection) so it re-attaches
   without a textual diff? The declarative form is more robust and strictly
   harder to author.
2. **Where does the harness live for a multi-version repo?** polyvers compares
   two version directories. A harness usually belongs to the *code*, not to a
   machine version — likely one harness at repo root referenced by relative
   path from each version's manifest, rather than a copy per version.
3. **Sidecar vs header for FR-6.2.** A `.meta.json` sidecar keeps `*.ndjson`
   parseable by everything that reads it today. A header line inside the file
   is atomic but breaks every existing reader. Sidecar chosen above; the
   trade-off is that a corpus can be separated from its provenance by a
   careless copy.
