---
name: preact-jsx-dev-runtime-alias
description: Fix a blank Electrobun renderer after a React-to-Preact compatibility migration when development builds still bundle React's JSX development runtime.
---

# Preact JSX development runtime alias

## Symptom

An Electrobun development renderer can render a blank window after React imports are aliased to Preact. The console may show an opaque runtime exception such as `TypeError: undefined is not an object (evaluating 'undefined.bind')`.

## Root cause check

The TypeScript development JSX transform imports `react/jsx-dev-runtime`, not `react/jsx-runtime`. If the view aliases only the production JSX runtime, the generated renderer mixes React's development JSX runtime with Preact compatibility modules.

After `bunx electrobun build --env=dev`, inspect `build/dev-macos-arm64/.../views/mainview/index.js`:

```sh
if grep -q '// node_modules/react/jsx-dev-runtime.js' build/dev-macos-arm64/Antimatter-dev.app/Contents/Resources/app/views/mainview/index.js; then
  echo 'React JSX dev runtime is still bundled'
fi
```

## Fix

In `electrobun.config.ts`, add the missing view alias alongside the existing React aliases:

```ts
"react/jsx-dev-runtime": "preact/jsx-dev-runtime",
```

Do not change unrelated application components to defer imports before confirming their code is startup-reachable.

## Verification

```sh
bunx electrobun build --env=dev && ! grep -q '// node_modules/react/jsx-dev-runtime.js' build/dev-macos-arm64/Antimatter-dev.app/Contents/Resources/app/views/mainview/index.js
```
