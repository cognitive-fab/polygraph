# Polygraph vs jobtree #100 — blind evaluation

Jean-Jacques Dubray · Cognitive Fab · 2026-09-12

Target: DavidLangworthy/jobtree PR #100 (spare top-up, swap-consumed index).
Configuration per D. Langworthy: spec + tests from 6d4bb25, implementation
rolled back to bc64bac — good spec, broken implementation, one file apart.

```
git checkout 6d4bb25                                   # spec + tests from #100
git checkout bc64bac -- controllers/run_controller.go   # roll the impl back
```

Verified: TestSpareTopUpDoesNotReprovisionSwapConsumedLowIndex FAILS
("top-up created 1 spare pods, want 0"); its sibling guard PASSES.

---


## Configuration (per David's correction)
    git checkout 6d4bb25                                    # spec + tests from #100
    git checkout bc64bac -- controllers/run_controller.go    # roll impl back one commit

Good spec, broken implementation, one file apart.
Verified: #100's own TestSpareTopUpDoesNotReprovisionSwapConsumedLowIndex FAILS
("top-up created 1 spare pods, want 0"); its sibling guard PASSES.

## Inputs
- contract.json  — 6 observable keys (pod0..2 in {Live,Gone}, reason0..2 in {None,Swap});
                   actions TopUp, LosePod{idx}, SwapConsume{idx}; declared = 3 spares.
- invariants.mjs — direct port of NodeFailure.tla's ConsumedSpareStaysConsumed.
                   (Only the podState conjunct is expressible; this contract does not
                   model dupPodState or leaseOpen. Stated, not silently dropped.)
- traces/        — 14 chained scenarios, 69 windows, captured from the REAL
                   emitSparePods executing (harness_test.go). validate_corpus: clean.

## Result — BROKEN implementation (bc64bac)
3 independent blind derivations. Replay against the 69-window corpus:

    spec_0   56/69   <- unfaithful; replay rejected it
    spec_1   69/69   faithful
    spec_2   69/69   faithful

Model check (exhaustive, keyless) of each against ConsumedSpareStaysConsumed:

    spec_1   VIOLATION
    spec_2   VIOLATION   <- shortest path:
      init                      pod=G,G,G  reason=N,N,N
      TopUp({})              -> pod=L,L,L  reason=N,N,N
      SwapConsume({idx:0})   -> pod=G,L,L  reason=S,N,N
      TopUp({})              -> pod=L,L,L  reason=S,N,N     <-- consumed index re-provisioned

spec_0 also reported a violation, but it is spurious: spec_0 models SwapConsume
as not removing the pod, which is why replay scored it 56/69. Replay discriminated
the bad derivation before its counterexample could mislead.

## Ground truth
The counterexample reproduces in the real Go trace corpus, scenario
s02_swap_low_index_then_topup:

    step1 TopUp{}                 G/N L/N... -> L/N  L/N  L/N
    step2 SwapConsume{"idx":0}    L/N L/N L/N -> G/S  L/N  L/N
    step3 TopUp{}                 G/S L/N L/N -> L/S  L/N  L/N   <-- pod0 Gone->Live while reason0=Swap

Real pre-fix execution: 22 of 69 windows violate the invariant.

## Control — FIXED implementation (6d4bb25)
Same contract, same invariant, same harness, same blind protocol:

    2/2 derivations replay 69/69 faithful
    both model check:  no invariant violations reachable
    real fixed execution: 0 of 69 windows violate

## Why replay reported 0 code-findings

This is the two legs doing their separate jobs, not a shortfall.

Replay asks ONE question: is this derived spec a faithful reading of the code?
A faithful spec reproduces the bug along with the code, so spec and trace agree
everywhere and replay has nothing to flag. 0 code-findings on specs 1 and 2 is
precisely what their 69/69 score means — the two numbers are the same fact.

spec_0 is the proof replay is doing real work: it scored 56/69, was rejected as
unfaithful, and its model-check "violation" was indeed spurious. Replay is the
gate that decides which counterexamples are worth believing.

The model check then asks the DIFFERENT question: does that faithful reading
reach a state the invariant forbids? It does, in 3 steps.

Together: a faithful reading of the code reaches a state your rule forbids —
therefore the defect is in the code, not in the reading. Neither leg establishes
that alone.

## Honest scope
- This is Tier 1: I wrote the contract and ported the invariant. Tier 2 (can the
  invariant be ELICITED without knowing the answer) is not run yet.
- Derivation ran in subagents handed only the contract + source — no PR, no TLA,
  no commit message. Prompt built by polygraph's own build_prompt.mjs; verified to
  contain zero occurrences of ConsumedSpareStaysConsumed / NodeFailure / #100.
- Deviation from the scripted pipeline: derivation transport was subagents rather
  than verify.mjs's API call. Same prompt builder, same replay, same checker.
- Observable state models podState only. ConsumedSpareStaysConsumed also constrains
  dupPodState and leaseOpen; those conjuncts are not expressible in this contract.
  Dropped explicitly, not silently.

---


The question Tier 1 could not answer. #100's real contribution was not the model
check — it was AUTHORING ConsumedSpareStaysConsumed. Tier 2 withholds that rule
entirely and asks whether the pipeline proposes it on its own.

## Protocol
- Input: the contract + the PRE-FIX Go seam. Nothing else. No PR, no TLA, no
  commit message, no invariants file. Prompt built by polynv's OWN buildPrompt()
  (polynv/src/llm.mjs), verified to contain zero occurrences of
  ConsumedSpareStaysConsumed / NodeFailure / #100 / TLA.
- 3 independent blind elicitors, each writing a JSON candidate array.
- Every candidate then evaluated MECHANICALLY — no judgement by eye:
    fails on the BROKEN corpus AND holds on the FIXED corpus  =  catches the defect
  Both corpora are real execution traces from the actual Go.

## Result
    42 candidates  (13 + 15 + 14)

    catches the defect (fails broken, holds fixed) : 17
    benign            (holds on both)              : 25
    too strong        (false alarms)               :  0
    unusable                                       :  0

### The headline
All THREE elicitors independently produced a state invariant whose truth table
over the complete 64-state space is IDENTICAL to David's ConsumedSpareStaysConsumed:

    cand_0  prior:consumed-capacity-not-double-spent
    cand_1  prior:consumed-slot-stays-empty
    cand_2  prior:consumed-spare-never-reprovisioned

    (s) => [0,1,2].every(i => s['reason'+i] !== 'Swap' || s['pod'+i] === 'Gone')

3/3, and every one of them classified it as a DOMAIN-PRIOR — "the rule any
practitioner would expect, independent of what the code does" — not as a
code-reading. That is the epistemically correct source for an intent-bearing
rule: code with a defect is a faithful description of the wrong behaviour, so an
invariant read OFF the code would be suspect. This one was not.

### Exhaustive check using ONLY elicited invariants (nothing I wrote)
    BROKEN machine: 2 violations
      prior:consumed-slot-stays-empty  [state]
        init -> TopUp -> SwapConsume{idx:0} -> TopUp   (consumed index re-provisioned)
      llm:topup-restores-every-unconsumed-index  [transition]
        init -> TopUp -> LosePod{idx:2} -> SwapConsume{idx:0} -> TopUp
        (pod2 stays Gone — the genuinely-missing HIGH index is never refilled)

    FIXED machine: no invariant violations reachable

The second one matters: the elicited set is STRICTLY STRONGER than the invariant
I ported in Tier 1. ConsumedSpareStaysConsumed catches the re-provisioning half.
The elicited transition invariant also catches the UNDER-provisioning half — the
symmetric defect #100's prose describes but which that invariant does not express.

### Catch rate by source
    domain-prior   10/24
    code-reading    7/18

## Honest scope
- polynv's KEYLESS harvest (templates + miners + pre-check) did NOT get there.
  It produced 8 candidates: 7 trivial (in-domain type constraints, precedence
  artifacts) and 1 mined correlation ("pod0 Gone implies reason1 None") which its
  own pre-check correctly rejected as FAILS — an artifact, not a rule. The
  mechanical miners found nothing intent-bearing. The LLM arm is what worked.
- The elicitors saw the function's own comment: "A spare consumed by a
  node-failure swap ... is not re-provisioned." The intent was DOCUMENTED while
  the implementation violated it. A real polynv run sees that comment too, so
  including it is faithful — but it is a material part of why this worked, and a
  codebase without such a comment is a harder case.
- 25 of 42 candidates are benign. A human still triages. That is polynv's stated
  design — it prepares an interview, it does not hold acceptance.
- I chose which candidates to put in elicited-invariants.mjs, but by the
  mechanical criterion above, not by reading them.
