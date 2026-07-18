# Orion Peripheral Awareness — Discussion Notes

## The core insight

The cost of noticing is near-zero because Orion is already reading the file. We're just not asking it to pay peripheral attention.

Right now when Orion reads a file, the prompt says "read this for task X." All attention goes to task X. But the model is processing the whole file anyway — the information is there, we're just not asking for the sidebar.

## The annotated read pattern

Simplest version: when Orion reads any file during a task, the output format includes an optional incidental observations field alongside the task findings. Not a separate LLM call — just the model producing two things at once:

```
task_finding: [what I found for the current task]
incidental: "line 347 — token endpoint has no rate limiting"
```

These accumulate to a session buffer and surface at task completion:
> "While working I also noticed: [2–3 things]. Worth a look, not blocking."

## Signal-to-noise is the whole design challenge

A model that surfaces 40 potential issues trains the user to ignore it within a week. The filter has to be:

- **High confidence only** — not speculation. "This null check is missing" yes. "This might be a problem under certain conditions" no.
- **Actionable** — "This function has no error handling and will silently fail" yes. "This code is complex" no.
- **High impact if left unfixed** — security holes, data loss risks, obvious null dereferences, error-swallowing catch blocks.
- **Not redundant** — if Orion is already fixing error handling, don't surface more error handling issues from the same file.

## The contractor analogy

You didn't hire them to fix the gutters, but they were up on the roof anyway. The marginal cost of noticing was near-zero. What makes a great contractor vs. adequate is partly that they're paying attention to the whole situation while doing the specific job.

## The one risk to avoid

Making it interrupt the current task. It should accumulate silently and surface at a natural handoff — not stop mid-implementation to say "wait, I noticed something." The supervisor is an interesting channel for this too: it already watches the agent's actions and could accumulate observations as a byproduct of monitoring.

## Open question

What's the right threshold between what's worth surfacing vs. noise? That calibration is probably the hardest part to get right.
