Use the lumen skill for searching this repo.

## React Performance Guidelines

When writing or modifying React components in this codebase, follow these performance best practices:

### Component Memoization

**Always use `React.memo` for:**
- List item components (message rows, channel items, etc.)
- Components that receive complex props
- Components that render frequently but don't always need updates

**Custom comparison functions:**
For expensive components, provide a custom comparison function to `memo`:
```tsx
const MessageRow = memo(function MessageRow(props) {
  // component
}, (prevProps, nextProps) => {
  // Return true if props are equal (skip re-render)
  // Return false if props changed (re-render)
  return prevProps.post.id === nextProps.post.id &&
         prevProps.post.update_at === nextProps.post.update_at;
});
```

### Hook Memoization

**Use `useMemo` for:**
- Expensive computations (filtering, sorting, grouping large arrays)
- Object/array literals passed as props
- Functions that transform data

**Use `useCallback` for:**
- Event handlers passed to memoized child components
- Functions passed as props to child components
- Functions used in dependency arrays

**Example:**
```tsx
// Memoize expensive data transformation
const timelineRows = useMemo(() => buildTimelineRows(posts), [posts]);

// Memoize callbacks passed to children
const handleReply = useCallback((post: MattermostPost) => {
  startReply(post);
}, [startReply]);

// Memoize inline computations
const groupedReactions = useMemo(
  () => groupReactions(post.metadata?.reactions ?? [], currentUserId),
  [post.metadata?.reactions, currentUserId]
);
```

### Avoid Common Anti-Patterns

**Don't:**
- Create objects/arrays inline in render: `<Child items={[1, 2, 3]} />`
- Define functions inline: `<button onClick={() => handleClick(id)} />`
- Access nested props in render: `userColors[post.user_id]` (extract to variable)

**Do:**
- Extract to variables: `const items = useMemo(() => [1, 2, 3], [])`
- Use `useCallback`: `const onClick = useCallback(() => handleClick(id), [id])`
- Pre-compute in component body: `const userColor = userColors[post.user_id]`

### Parent Component Responsibilities

When a component receives callbacks as props:
1. Ensure parent wraps them in `useCallback`
2. Keep dependency arrays minimal and stable
3. Consider moving handlers to context if passed through many layers

### When to Optimize

**Optimize when:**
- Component renders >50 items in a list
- User reports visible lag or jank
- React DevTools Profiler shows >16ms render time
- Component re-renders frequently (typing, animations, real-time updates)

**Don't optimize prematurely:**
- Simple components with few children
- Components that rarely re-render
- One-off components

### Testing Performance

After optimization:
1. Use React DevTools Profiler to measure render times
2. Verify only affected components re-render (not entire tree)
3. Test with realistic data volumes (60+ messages, 100+ channels)
4. Check for layout shifts in Chrome DevTools Performance tab

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
