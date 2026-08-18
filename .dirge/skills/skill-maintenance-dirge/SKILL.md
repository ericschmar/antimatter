---
name: skill-maintenance-dirge
description: Pitfalls and recovery rules for maintaining .dirge SKILL.md files in Antimatter — YAML frontmatter validation failures on patch, stale cached loads, and committing skill edits.
---

# .dirge skill maintenance pitfalls

## "Patch would break skill frontmatter — rejected"

The `skill` patch action validates the resulting SKILL.md YAML frontmatter. A frontmatter `description:` whose plain scalar contains `": "` (colon-space, e.g. `content issues: restored`) — or embedded double quotes — makes the YAML invalid, and EVERY patch to that skill is rejected with `Patch would break skill frontmatter`, even body-only edits that don't touch frontmatter.

Recovery (confirmed working on `antimatter-chat-workspace-startup-loading` in the same session where the body-only patch was rejected):
1. First patch the `description:` line ITSELF to a clean value (no `": "`, no double quotes — em dashes and single quotes are safe).
2. Then re-apply the body patch; it succeeds once frontmatter parses.

Prevention: keep colons and double quotes out of skill frontmatter descriptions (em dashes and single quotes are safe).

## `skill load` can serve a stale or wrong-registry copy

`skill(action='load')` may show an older snapshot (missing recently added `name:` frontmatter or whole sections) or even a different registry entirely (system-bundled skills instead of `.dirge/skills`) — observed within a single turn, while `patch`/`list` operated on the current repo files. Trust `patch`/`list` results and `sed`/`git diff` over the loaded view when they disagree; re-running load doesn't always refresh.

## Committing skill edits

Skill maintenance edits under `.dirge/skills/` accumulate as uncommitted working-tree changes and are easy to leave behind after a feature commit+push (seen after the empty-screen feature: `.beads/interactions.jsonl` plus SKILL.md edits in four skills stayed unstaged because `git pull --rebase` refuses to run with unstaged changes, so the pre-push sequence silently degrades to push-only). Before handoff, check `git status` and either fold `.dirge`/`.beads` changes into a maintenance commit or remove them if unrequested.

## Verification

```bash
grep -c "break skill frontmatter" .dirge/skills/skill-maintenance-dirge/SKILL.md && git status --short .dirge .beads
```

Should print `1` (or more) plus the currently-dirty skill/beads paths. To confirm the stale-load caveat live, compare `skill load <name>` output against `sed -n '1,10p' .dirge/skills/<name>/SKILL.md` after a fresh patch.
