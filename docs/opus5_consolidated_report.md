# Opus 5 vs Fable 5: is the expensive model worth it?

*2026-07-24*

Claude Opus 5 came out, so I tested it against Claude Fable 5 on two tools I already had
benchmarks for.

The reason this is worth writing up: **Fable 5 costs exactly twice as much.** $10 per million
input tokens and $50 per million output tokens, against $5 and $25 for Opus 5. If you are
paying for the expensive model, the only question that matters is whether you are getting
anything for it.

Short answer: on reading code, no — Opus 5 was better. On writing formal specifications,
yes, but only if you never retry a failure.

Here is the whole result in one table. The rest of this explains what these tests are and
why the two rows disagree.

| | Test 1: reading code | Test 2: writing a spec |
|---|---|---|
| **Opus 5** ($5 / $25) | 5/5 bugs found, **0 false alarms** | **1/5** first try → 5/5 after one retry † |
| **Fable 5** ($10 / $50) | 5/5 bugs found, 1 false alarm | **5/5** first try † |

† Test 2 is a small sample — five runs for Opus 5, a **single run** for Fable 5. Read the
spec-writing column as suggestive, not settled; the detail is in [Test 2](#test-2-can-the-model-write-a-formal-specification)
below. Test 1 is N=3 per model.

---

## Test 1: can the model read code accurately?

### What the tool does

The tool is called Polygraph. You give it two things: your code, and a short description of
what the code is *supposed* to do.

An AI model reads **only the code**. It never sees the description. Its job is to write down
the rules it thinks the code follows — things like "the balance is never negative" or "once an
order is cancelled it can't be paid."

Then the tool checks those rules two ways:

1. **Replay** — take real recorded runs of the program and check them against the rules.
   Fast and cheap.
2. **Exhaustive search** — try every possible sequence of steps, looking for one that breaks a
   rule. Slow and expensive.

Anywhere the rules and the intended behaviour disagree, you probably have a bug.

### How I score a model

I have eight small programs:

- **Five** have a bug I planted on purpose. The model should find them.
- **Two** are clean. The model should say nothing.
- **One** has a problem this method genuinely cannot detect. The model should also say
  nothing — claiming to have found it would be a false alarm.

A script grades the output against the answer key, so the model never marks its own homework.

### The result

| | Bugs found (of 5) | False alarms (of 3 clean-ish programs) |
|---|---|---|
| **Opus 5** | 5 | **0** |
| Fable 5 | 5 | 1 |

Both models found every planted bug. The difference is the false alarm, and that is the number
I care about most. **A tool that cries wolf is a tool people turn off.** A missed bug costs you
one bug; a tool nobody trusts costs you all of them.

Zero false alarms is the first time any model has managed it here. And Fable 5's single wrong
flag was on the hardest case in the set — the program whose problem the method genuinely can't
see, where the correct answer is to stay quiet and admit it. That is the one thing in this
benchmark that requires real judgement, and the cheaper model is the one that got it right.

### The result that looked like a regression

Remember there are two checks: replay is cheap, exhaustive search is expensive.

| | Bugs caught by the cheap check | Bugs needing the expensive check |
|---|---|---|
| Fable 5 | 2 of 5 | 3 of 5 |
| **Opus 5** | **0 of 5** | **5 of 5** |

Opus 5 caught nothing with the fast check. That looks bad until you work out what the fast
check actually tests.

**Replay only fires when the model's written-down rules disagree with what the code really
did when it ran.** Read that again: that is a disagreement between the *model* and the *code*.
It catches the model being wrong, not the code being wrong.

Opus 5 read the code more accurately. Its rules matched what the program actually does. So
replaying real runs found nothing to complain about — correctly.

The bug was still there the whole time. A planted bug is a gap between **what the code does**
and **what the code is supposed to do**, and only the exhaustive search compares against what
it's supposed to do. Better reading means a quieter fast check and more work for the slow one.

**Why you should care:** if you run only the fast check on every commit because it's cheap,
upgrading to a more accurate model makes that check quieter without making your code any
safer. Know which of your checks are testing the model and which are testing the code. They
are not the same thing.

---

## Test 2: can the model write a formal specification?

### What the tool does

The tool is called SysMoBench. It gives a model the source code of a real system and asks it
to write a **formal specification** — a precise mathematical description of how the system
behaves, in a language called TLA+.

The point of writing one is that you can then run a **model checker**: a program that
mechanically explores every state the system can reach and tells you if a rule is ever broken.
It is exhaustive in a way tests are not.

The benchmark scores the specification in four phases: does it parse, does the model checker
run cleanly on it, do recorded traces from the real system replay against it, and does it
satisfy the invariants a human expert wrote.

I ran the smallest task five times: a spinlock (the low-level thing that stops two threads
from entering the same critical section at once) from an operating system kernel.

### The result

| Phase | Opus 5 |
|---|---|
| 1. Does it parse? | **5/5** |
| 2. Does the model checker run? — first try | **1/5** |
| 2. Does the model checker run? — after one retry | **5/5**, nothing broken |
| 4. Does it satisfy the expert invariants? | **35/35** |
| 3. Do real traces replay? | Not run — my tool is broken on Windows |

Four of the five failed the model checker having explored **zero states**. All four contained
the same line, character for character:

```tla
NULL == CHOOSE v : v \notin Threads
```

In plain English that says: *"let NULL be some value that isn't a thread."* It's a placeholder
meaning "nobody holds the lock."

It reads fine, and the parser accepts it. But the model checker refuses to evaluate it, because
"some value that isn't a thread" describes an infinite set of candidates and it has no way to
pick one. The specification is rejected before it explores a single state.

The one run that passed shows the model knows the right way to write it: declare the
placeholder up front as a named constant, and the tooling binds it to a real value. Same
prompt, same task, five times. The only difference is which phrasing that particular sample
happened to reach for.

**So a 1/5 score here is not "Opus 5 understands one fifth of a spinlock."** The failure is one
line of syntax, and it sits entirely upstream of anything to do with locks or threads — the
specification never gets far enough to be wrong about the system. Show the model the checker's
error message once and all four fix themselves, with no damage to the one that already worked.

Fable 5 passed this cold, first try. So on a single attempt with no retry, the expensive model
is genuinely ahead.

Two honesty notes. Fable 5's result is a **single run** — one sample against Opus 5's five, so
treat the comparison as suggestive, not settled. And three identical Opus 5 failures in a row
made this look deterministic until the fourth run broke the pattern; three samples would have
given me a confident wrong answer.

### The part that cost me the most time was my own code

Three bugs in my test harness, two of which produced wrong scores that had nothing to do with
the model:

1. **The invariant checker collided with itself.** It appends its own copy of each expert
   invariant to the model's specification. If the specification already defines something by
   that name — which it does whenever the model names its invariants after the documentation —
   the parser rejects the whole file and the invariant is scored as failed. The specification
   was being punished for following the naming convention. Fixing this took Phase 4 from
   "several failures" to a clean 35/35.
2. **The retry step grabbed the wrong code block.** It took the *first* fenced code block in
   the reply. When the reply quoted the broken line before showing the fix, my code kept the
   quote and threw away the actual specification.
3. **Phase 3 doesn't run on Windows at all.** File paths were being passed to a shell that
   treats backslashes as escape characters, so the path fell apart.

**When a new model gives you a surprising result, check your harness first.** It was written
against the old model.

---

## Why the two tests disagree

Opus 5 wins on reading code and loses on writing a specification, against a model costing
twice as much. Both results are real. They disagree because the two tasks need different
things.

The resolution is that the specification gap is a **habit**, not a misunderstanding. Opus 5's
specifications fail on one line of syntax that a single round of error feedback fixes
completely, and once past it, it satisfies every expert invariant. There is no evidence it
understands the system less well.

That turns the decision into a question about your pipeline, not about model quality:

- **If you feed errors back and retry** — use the cheaper model. The gap closes to nothing and
  you halve your bill.
- **If it's one shot with no retry, and the output is formal-methods code** — the expensive
  model is still buying you something.

Neither test is big enough to settle this on its own, especially with Fable 5 at one sample on
the second test. But "the cheap model catches up once you add a retry" is easy to check on
your own workload, and worth checking before you commit to double pricing.

---

## The thing I didn't expect: the model refused

Two Polygraph runs came back completely empty. The API had declined to answer, flagging the
request as security-related.

I narrowed it down. It wasn't my prompt. It was a comment in the code being analysed:

> the guard that is supposed to reject partial payments only checks for zero, so a real
> partial payment slips through and gets charged

That's twenty lines of payment logic with an honest note about its own bug. Even asking plainly
"what does this code do?" got refused.

This matters because it is the exact shape of the job. **Every request this tool sends is "here
is some code, here is how it might be wrong."** That is also what somebody hunting for an
exploit sounds like. A safety filter that can't tell those apart can't read a codebase that has
honest comments in it.

This is not a reason to pick one model over the other — Fable 5 refused on a different program
in the same set. It's a property of the work.

### How to handle it in code

A refusal is **not an exception and not an error status.** You get a normal HTTP 200 back with
`stop_reason` set to `"refusal"`. Code that reaches straight for `response.content[0]` will
break on it:

```python
response = client.messages.create(
    model="claude-opus-5",
    max_tokens=4096,
    messages=[{"role": "user", "content": prompt}],
)

if response.stop_reason == "refusal":
    handle_refusal(response.stop_details)   # content is empty or partial
else:
    print(response.content[0].text)
```

Check `stop_reason`, not `stop_details` — the details are informational and can be missing even
on a real refusal.

Better still, ask the API to retry on another model for you, so you never see the refusal:

```python
response = client.beta.messages.create(
    model="claude-opus-5",
    max_tokens=4096,
    betas=["server-side-fallback-2026-07-01"],
    fallbacks="default",
    messages=[{"role": "user", "content": prompt}],
)
```

`fallbacks="default"` lets the API choose the backup model based on *why* the request was
refused, so you don't maintain a list. Security-category refusals go to `claude-opus-4-8` —
which answers the payment-comment prompt without complaint, so the retry genuinely rescues the
request. A refusal that happens before any output isn't billed at all. This is a Claude API
feature; on Bedrock, Vertex and Foundry you use the SDK's client-side fallback middleware
instead.

**If you are building anything that analyses code with an AI model, treat "the model refused"
as a normal failure you handle, not a weird edge case.**

---

## What to take away

**1. Judge a checking tool by its false alarms, not its hit rate.** Both models found all five
planted bugs. Only Opus 5 stayed quiet on all three programs where silence was the right
answer — and it costs half as much.

**2. A more accurate model makes your cheap check quieter, not your code safer.** If your fast
check works by spotting disagreements between the model and the code, a better model produces
fewer of them. Budget for the slow check.

**3. Handle refusals.** Check `stop_reason`, and set `fallbacks="default"`. Both models refused
something here.

**4. One run per test case tells you very little.** The Opus 5 / Fable 5 gap on the
specification task was one line of syntax that a single retry erased — and if I'd stopped at
one attempt each, that noise would have talked me into paying double.

**5. Check your own harness before blaming the model.** Two of my three worst-looking results
were bugs in my test code, not the model's output.

---

### Models and prices referenced

| Model | ID | Input / output per million tokens |
|---|---|---|
| Claude Opus 5 | `claude-opus-5` | $5 / $25 |
| Claude Fable 5 | `claude-fable-5` | $10 / $50 |
| Claude Opus 4.8 | `claude-opus-4-8` | $5 / $25 |
| Claude Sonnet 5 | `claude-sonnet-5` | $3 / $15 |

Full detail on the Polygraph A/B — per-machine tables, both arms, all three model runs — is in
[`../eval/AB-V2-RESULTS.md`](../eval/AB-V2-RESULTS.md). The SysMoBench per-run tables, the harness
bugs, and artifact locations live with the SysMoBench harness (not in this repo).
