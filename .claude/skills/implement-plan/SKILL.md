---
name: implement-plan
description: Execute or resume an existing implementation plan through sequential Implementation subagent sessions, reviewing changes and validation and preserving durable progress until completion or a concrete blocker.
---

Execute or resume this implementation plan:

<plan_request>
$ARGUMENTS
</plan_request>

You own user communication, task selection, delegation, and review. Use the
custom Implementation agent defined in `.claude/agents/implementation.md`.
Read its instructions before delegating so you know what it already does and
what your prompt must add. Run one Implementation session at a time; wait for
its completion notification rather than polling, and review its saved work
before launching the next. Invoking this skill authorizes implementation within
the requested scope, without a fresh confirmation at every task or session
boundary.

The saved plan is the authoritative progress record. Agent messages summarize
it; they do not replace it. Continue across sessions until the requested work
passes review or further progress requires a concrete decision or external
action.

## Establish the starting state

Resolve the plan path from the arguments and conversation. If the reference is
empty or ambiguous, look for matching plans in `agents/plans/`; ask the user to
identify the plan only when more than one plausible match remains. Read the
entire plan and the documents its tasks cite.

Check the working tree (`git status`) and recent commits before delegating.
Identify existing changes, completed work, incomplete tasks, and blockers.
Preserve unrelated and user-authored changes; tell the agent which existing
edits belong to this work. Do not require a clean tree or reset changes to make
the plan easier to run.

Check that the requested scope has stable task IDs, valid dependencies,
observable acceptance criteria, and practical validation. Reconcile stale
statuses with the actual repository state. Repair execution details supported
by the codebase, retaining task IDs and settled requirements. Record material
discoveries in the plan. Do not silently invent product decisions or weaken
acceptance criteria to make work pass.

## Delegate a bounded session

The Implementation agent's own instructions cover reading the plan and task
documentation, status updates, handoff notes, validation, scoped commits, the
token budget, and its final report. Do not restate them. Give each agent what
it cannot know on its own:

- The exact plan path, the requested scope, and the eligible follow-on tasks.
- Confirmed decisions and scope boundaries not yet recorded in the plan, and
  relevant repository findings.
- Existing working-tree changes: which belong to this work and which are
  unrelated and must not be staged.
- A reminder that you own user communication. It must return questions and
  proposed scope changes to you, with recommendations, instead of independently
  interviewing the user or seeking confirmation already given.

An agent may complete multiple ready tasks within its session. Its 250k-token
budget is approximate; the actual context limit takes precedence. Do not claim
a budget has been configured or measured when the tools do not expose that
capability.

## Review before continuing

After each session, read the updated plan and inspect the actual commits and
diff. Use `git show --stat` first and read full diffs for the files that
matter, to keep your own context available for later sessions. Re-run the
task's validation commands yourself. Check that:

- Changes satisfy the task's scope, acceptance criteria, and design invariants.
- Required tests, linting, documentation, and applicable manual checks have
  evidence of completion. A skipped or unavailable check is clearly identified
  with its reason and impact; an undocumented exception is not a pass.
- The plan's `Progress and handoff` section is complete and factual. No
  essential continuation detail exists only in the agent's reply.
- Unrelated changes are preserved and commits contain only the intended work.

Return actionable gaps to the same agent with SendMessage if it has context
left; otherwise give them to a fresh Implementation agent. Fix problems in new
commits; never amend, rebase, or otherwise rewrite history. Review the
corrections. Do not advance dependent tasks on the strength of an agent's
completion claim.

When review passes and eligible work remains, launch a fresh session as needed
using the saved plan and current repository state. Do not ask the user to
restart the workflow merely because one agent reached its budget.

## Resolve blockers and prevent stalled retries

Investigate codebase questions yourself or delegate focused exploration to the
Explore agent. Resolve routine implementation choices using project conventions
and confirmed requirements. Bring unresolved product behavior, scope changes,
or consequential tradeoffs to the user, with a recommendation. Record the
question and affected task IDs in the plan; missing answers are not approval.

Respect repository restrictions: never push, deploy, or install dependencies.
Implementation authorization does not override them. For operator-only steps,
leave a concrete runbook with prerequisites, actions, and verification in the
affected task.

Compare each session's result with its starting state. A fresh agent is useful
for context exhaustion, not as a way to retry an unchanged blocker. If a session
makes no meaningful progress, identify the cause and give one focused corrective
attempt only when there is a plausible remedy. If the same failure persists,
save the evidence and stop that path. Continue independent tasks if available;
otherwise return the blocker and the specific input or action needed to resume.

## Finish and report

Before declaring completion, review the requested scope as a whole: all
acceptance criteria must be satisfied, required validation must have passed or
have an explicitly accepted exception, and no required decision may remain
unresolved. Run the full test suite (`node lib/run-tests.js`, and
`node devkit/run-tests.js` if `devkit/` changed) and the linter on every
JavaScript file changed by the plan (`node lib/run-linter.js <paths>` or
`node devkit/run-linter.js <paths>`), and perform any plan-level integration
checks not covered by task validation.
Correct discrepancies in the plan before reporting the result.

Finish with a link to the updated plan, a concise summary of the implemented
outcomes, the commits, validation results, and any remaining operator actions
or blockers. If implementation is ready but deployment or another required
operator step is pending, say so explicitly; do not call the entire plan
complete. If stopping early, name the incomplete task IDs and the next action
needed to resume.
