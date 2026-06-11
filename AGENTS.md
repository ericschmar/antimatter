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
