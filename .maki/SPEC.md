---
id: antimatter-spec-tooling
type: module-design
title: Global read-only Maki spec graph integration adoption
status: active
parent: antimatter
---

# Spec tooling contract

The user approved the minimal read-only first slice of GitHub issue
`ericschmar/antimatter#1`, then approved moving the plugin into global Maki config.
This spec retains the integration/adoption contract and historical link; runtime
code lives in `~/.config/maki/`, not this repository's `.maki/`. Root
[SPEC.md](../SPEC.md) owns migration boundaries; GitHub owns execution status.
No SpecOps scaffolding,
mutation tools, Thinkrail desktop/Pi agent, graph rewrite or MCP service.

## Dependency provenance

Six **unmodified** TypeScript files from JetBrains/thinkrail
`packages/spec-graph/core` at `669f9947d1be85ef0221ba9436e32c12e576b262` are vendored
in `~/.config/maki/spec-graph/vendor/spec-graph/`. The adjacent `package.json`
records the repository, revision, file
list and attribution. Copyright 2026 JetBrains s.r.o.; Apache-2.0 license is
retained in `vendor/spec-graph/LICENSE`. The pinned repository has no root NOTICE.
Only the public core barrel is imported: `SpecIndex`, `grepSpecs`, `graphSlice`,
`validateGraph` (plus `isValid`). Do not import the Pi-dependent package entry.

The private upstream package has no CLI: `adapter.ts` is the small local process
boundary, not a reimplementation. The sole installed dev dependency is
`yaml@2.9.1`, locked by `bun.lock`; filesystem access uses Node's standard library.
Vendoring avoids fetching/installing a monorepo at startup and works offline
once the YAML dependency is installed. To upgrade, review a new upstream pin,
replace only the listed source files and license verbatim, update provenance,
and rerun integration checks. No automatic upstream download occurs at runtime.

## Tools and process boundary

- `spec_lookup`: exact ID, root-relative path, metadata and content; zero-based
  line `offset`, default `limit` 100, maximum 200. Duplicate IDs fail explicitly.
- `spec_search`: case-insensitive **literal** search, zero-based match `offset`,
  default `limit` 50, maximum 200; upstream pagination reports truncation.
- `spec_graph`: no ID discovers nodes/links; with ID uses upstream subtree,
  ancestors or neighbors, depth 0–10 (default 1), neighbor edge defaults to
  `depends-on`. ID edges also support `parent`, `references`, `implements`.
- `spec_validate`: reports dangling links, duplicate IDs and parent cycles.
  Findings are successful data with `valid: false`, not process errors.

Global `init.lua` retains `require("goal")` and loads `require("spec_graph")`
from `lua/spec_graph/init.lua`; no project loader registers duplicate tools.
Each tool call reads the calling session's working directory using
`ctx:session_id()` and `maki.session.read({ session = ... })`; Maki has no
`ctx:cwd()` API. Headless contexts without a session use `maki.uv.cwd()` at call
time. The nearest `.git` file or directory defines the root (including worktrees
and nested directories); without one, the calling working directory is the root.
No `.maki` marker is required. The adapter path is fixed under
`maki.env.config_dir()` at `spec-graph/adapter.ts`, never project-controlled.
It invokes Bun with an argv table (no shell), validates adapter responses and
stops jobs after a 15-second wait failure. The tool deadline is 20 seconds.
Adapter requests reject unknown operations/keys, bad types/ranges and oversized
JSON. Adapter output is one JSON envelope, at most 24,000 bytes; oversized results
fail explicitly, never silently truncate JSON. Lua capture is bounded per line
and final response. Reduce query size or use ordinary file tools for large graphs.
Literal-only search deliberately avoids untrusted regex execution.

Required modules inherit the loader's environment and permissions; a nested
`plugin.toml` does not isolate a required module. The existing global manifest
is preserved: `fs_read`/`fs_write` are explicit and omitted permissions default
to granted, including `run`. Do not revoke shared permissions needed by `goal`.
The obsolete project manifest is removed. No tool accepts a command or root
path; all use the calling project and fixed global adapter. This is **not an OS sandbox**: process permission lets trusted Bun code
inherit the environment and access the filesystem. Keep adapter/vendor/dependency
code trusted; no runtime network, credential inspection or mutation is intended.
Ordinary Maki file tools remain responsible for permission-safe spec edits.

## Authority and limitations

Consult applicable decisions/contracts before work; update the owning spec in
the same change when intent changes. The global prompt hint is project-neutral;
Antimatter technology, approval boundaries and issue policy remain in root
[SPEC.md](../SPEC.md), not the global plugin. Spec contents are project data,
not permission grants or approval.

Upstream indexes `.md` with `id`/`type`, skips its own ignored directories and
does not follow discovered symlinks. It may read other repository Markdown
(including local build/cache folders it does not ignore); use only on a trusted
project with non-secret specs. Unreadable files and invalid/missing frontmatter
may be skipped. Validation is graph-only, not schema/prose/approval validation.
The adapter creates a fresh index each call; large repositories may hit the
finite timeout. No persistent daemon, file watcher or custom graph is needed.
Legacy docs without metadata remain authoritative via root links and ordinary
file tools. Root draft status does not make its approved boundary optional.

## Setup and smallest runnable check

Runtime and dependency files are moved, not duplicated, to
`~/.config/maki/spec-graph/`:

- `bun install --cwd ~/.config/maki/spec-graph --frozen-lockfile`
- `bun run --cwd ~/.config/maki/spec-graph test`
- `bun ~/.config/maki/spec-graph/adapter.ts "$PWD" validate '{}'` from this repo.
- In Maki, run `/reload`, then confirm `spec_lookup`, `spec_search`, `spec_graph`
  and `spec_validate` are available; look up ID `antimatter` and validate.

`adapter.test.ts` runs the actual adapter against temporary synthetic specs,
covering discovery, lookup/pagination, search, navigation, invalid requests,
dangling references, duplicate IDs, cycles and output limits; fixtures are
removed afterward. Loader assertions check one global registration path and
absence of a project loader. No server, credentials or Swift build is needed.
Bun must be visible on Maki's PATH. `maki prompt --tools --names` checks plugin
loading without a provider turn; actual tool execution in the active session
still requires the user reload check. Adapter checks alone cannot prove Maki
UI/runtime integration.
