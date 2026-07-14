# WebRTC Implementation Prompts

Prompt suite for agents working from `WEBRTC_IMPLEMENTATION_GUIDE.md`.

## Success Criteria

- Read relevant parts of `WEBRTC_IMPLEMENTATION_GUIDE.md` before changing code.
- Map guide steps to existing project files and conventions.
- Implement only the requested phase or task.
- Verify changes with available tests, build, lint, or typecheck commands.
- Report blockers, guide deviations, and unverified areas clearly.

## General Rules for All Prompts

- Treat `WEBRTC_IMPLEMENTATION_GUIDE.md` as implementation guidance, not guaranteed-current source of truth.
- Do not blindly copy guide snippets or file paths.
- Inspect the actual codebase before proposing or making code changes.
- Use Beads (`bd`) for persistent task tracking if creating issues.
- Do not commit or push unless explicitly requested.
- Do not add dependencies without asking.
- Keep changes scoped to the requested phase or task.
- For React work, follow existing memoization and callback conventions.
- For Mattermost signaling, treat incoming signaling payloads as untrusted input.

## 1. Audit the Guide Against the Current Codebase

```markdown
You are working in the Antimatter/WebRTC repo.

Task: Audit `WEBRTC_IMPLEMENTATION_GUIDE.md` against the current codebase.

Read the guide outline first, then inspect only the files needed to answer whether the guide is still accurate.

Focus on:
- File paths that no longer exist.
- APIs, types, imports, or architectural assumptions that do not match the codebase.
- Steps that are underspecified for implementation.
- Security or privacy concerns around Mattermost signaling messages.
- React integration points that conflict with existing component structure.
- Existing code that already implements parts of the guide.

Do not modify files unless explicitly asked.

Return:
- A concise list of guide inaccuracies.
- A concise list of implementation blockers.
- Suggested updates to `WEBRTC_IMPLEMENTATION_GUIDE.md`.
- A recommended implementation order.
- Any parts of the guide that appear safe to implement as-is.
```

## 2. Turn the Guide Into Implementation Tasks

```markdown
You are working in the Antimatter/WebRTC repo.

Task: Convert `WEBRTC_IMPLEMENTATION_GUIDE.md` into actionable implementation tasks.

Read the guide and inspect the repo structure enough to map each guide step to real files.

Create a phased task breakdown for:
- Phase 1: Foundation
- Phase 2: WebRTC Core
- Phase 3: UI Components
- Phase 4: Integration
- Phase 5: Polish & Testing

For each task include:
- Goal.
- Relevant guide section.
- Expected files to create or edit.
- Dependencies on previous tasks.
- Verification method.
- Risks or assumptions.

Follow repo workflow:
- Use Beads (`bd`) for task tracking if creating persistent work items.
- Do not commit or push unless explicitly requested.
- Do not add extra features beyond the guide.
- Prefer small, independently verifiable changes.

Return the task plan only. Do not edit files.
```

## 3. Implement Phase 1: Foundation

```markdown
You are working in the Antimatter/WebRTC repo.

Task: Implement Phase 1 from `WEBRTC_IMPLEMENTATION_GUIDE.md`.

Scope:
- Step 1.1: Define TypeScript types.
- Step 1.2: Update shared RPC types.
- Step 1.3: Create configuration.

Before editing:
- Read the relevant Phase 1 sections in `WEBRTC_IMPLEMENTATION_GUIDE.md`.
- Inspect the existing shared types, RPC types, and configuration patterns.
- Identify the exact files that should be changed.

Implementation rules:
- Match existing project style and naming.
- Do not create abstractions beyond what Phase 1 requires.
- Do not implement WebRTC runtime logic, UI, or integration yet.
- If the guide names files that do not exist, map them to the closest existing project structure and state the mapping.

Verification:
- Run the fastest available typecheck/build/lint command.
- If no clear command exists, inspect `package.json` or relevant config and report what could not be verified.

Return:
- Files changed.
- Verification result.
- Any guide deviations.
```

## 4. Implement Phase 2: WebRTC Core

```markdown
You are working in the Antimatter/WebRTC repo.

Task: Implement Phase 2 from `WEBRTC_IMPLEMENTATION_GUIDE.md`.

Scope:
- Step 2.1: Media Devices Manager.
- Step 2.2: Call Signaling Handler.
- Step 2.3: Core Call Manager.

Before editing:
- Read the relevant Phase 2 sections in `WEBRTC_IMPLEMENTATION_GUIDE.md`.
- Inspect existing Mattermost API, websocket, state-management, and service patterns.
- Confirm where call services should live in the existing source tree.

Required behavior from the guide:
- ICE candidate buffering before remote description is set.
- ICE candidate batching.
- Device switching via `replaceTrack()`.
- Remote stream assembly.
- Multi-tab coordination with `BroadcastChannel`.
- Session recovery.
- Sender validation.
- ICE restart handling.
- Cleanup of event listeners and media resources.

Implementation rules:
- Implement only the core non-UI logic.
- Do not wire UI components yet unless needed for compilation.
- Do not add unnecessary fallbacks or broad error handling beyond real boundary conditions.
- Treat Mattermost signaling data as untrusted input and validate sender/session fields.

Verification:
- Run typecheck/build.
- Add or update focused tests if the repo already has a nearby test pattern.
- If browser/WebRTC APIs make automated tests impractical, report manual verification steps.

Return:
- Files changed.
- Implemented guide requirements.
- Verification result.
- Known limitations.
```

## 5. Implement Phase 3: React UI Components

```markdown
You are working in the Antimatter/WebRTC repo.

Task: Implement Phase 3 from `WEBRTC_IMPLEMENTATION_GUIDE.md`.

Scope:
- Step 3.1: Call Context Provider.
- Step 3.2: Call Button.
- Step 3.3: Incoming Call Toast.
- Step 3.4: Active Call Panel.
- Step 3.5: Basic styling.

Before editing:
- Read the relevant Phase 3 sections in `WEBRTC_IMPLEMENTATION_GUIDE.md`.
- Inspect existing React context, toast, panel, button, and styling conventions.
- Identify where the call provider and surfaces belong in the app tree.

React rules:
- Use `React.memo` for frequently rendered/list-adjacent components.
- Use `useMemo` for derived objects/arrays passed as props.
- Use `useCallback` for callbacks passed into memoized children.
- Do not create inline object/array/function props where avoidable.
- Keep dependency arrays minimal and correct.

Implementation rules:
- Match existing UI style.
- Do not redesign unrelated UI.
- Do not implement Phase 4 integration unless needed for compilation.
- Keep the UI wired to the call context/service API defined by earlier phases.

Verification:
- Run typecheck/build/lint.
- If available, run affected UI tests.
- Report any manual browser checks needed.

Return:
- Files changed.
- UI surfaces added.
- Verification result.
- Any guide deviations.
```

## 6. Implement Phase 4: Integration

```markdown
You are working in the Antimatter/WebRTC repo.

Task: Implement Phase 4 from `WEBRTC_IMPLEMENTATION_GUIDE.md`.

Scope:
- Step 4.1: Initialize CallManager.
- Step 4.2: Hook into WebSocket.
- Step 4.2b: Filter signaling messages from timeline.
- Step 4.3: Add call buttons to UI.
- Step 4.4: Add call surfaces.

Before editing:
- Read the relevant Phase 4 sections in `WEBRTC_IMPLEMENTATION_GUIDE.md`.
- Inspect app initialization, websocket event handling, timeline rendering, DM/channel UI, and top-level providers.
- Confirm where Mattermost post filtering should happen.

Implementation rules:
- Keep signaling messages out of the Antimatter timeline where the guide requires it.
- Do not hide or mutate unrelated Mattermost posts.
- Ensure sender validation remains intact.
- Keep changes scoped to WebRTC integration.
- Avoid broad rewrites of existing websocket or timeline code.

Verification:
- Run typecheck/build/lint.
- If possible, test websocket event handling with existing tests or mocks.
- Provide manual test steps for a local two-client call flow.

Return:
- Files changed.
- Integrated call entry points.
- Verification result.
- Manual test checklist.
```

## 7. Implement Phase 5: Polish and Testing

```markdown
You are working in the Antimatter/WebRTC repo.

Task: Implement Phase 5 from `WEBRTC_IMPLEMENTATION_GUIDE.md`.

Scope:
- Step 5.1: Desktop notifications.
- Step 5.2: Error handling.
- Step 5.3: Testing checklist.

Before editing:
- Read the relevant Phase 5 sections in `WEBRTC_IMPLEMENTATION_GUIDE.md`.
- Inspect existing notification and error handling patterns.
- Inspect existing test framework and nearby tests.

Implementation rules:
- Add only the polish/error behavior described by the guide.
- Validate only at boundaries: user permissions, browser media APIs, Mattermost messages, websocket payloads.
- Do not add speculative retry systems or generic error frameworks.
- Keep user-facing error messages consistent with existing style.

Verification:
- Run affected tests.
- Run typecheck/build/lint.
- Add a manual WebRTC test checklist if automation cannot cover real media/network behavior.

Return:
- Files changed.
- Tests added or updated.
- Verification result.
- Remaining manual checks.
```

## 8. Review an Implementation Against the Guide

```markdown
You are working in the Antimatter/WebRTC repo.

Task: Review the current WebRTC implementation against `WEBRTC_IMPLEMENTATION_GUIDE.md`.

Do not modify files.

Review for:
- Missing guide requirements.
- Incorrect Mattermost signaling behavior.
- Race conditions around ICE candidates and remote descriptions.
- Leaked event listeners, streams, tracks, peer connections, timers, or BroadcastChannels.
- Sender/session spoofing risks.
- Timeline filtering mistakes.
- React performance issues in call UI.
- Incomplete cleanup on hangup, refresh, navigation, or tab close.
- Missing tests or manual verification gaps.

Return findings as:
- Critical issues.
- Functional bugs.
- Security/privacy issues.
- Test gaps.
- Guide deviations.
- Recommended next fixes in priority order.
```

## 9. Update the Guide After Implementation Discoveries

```markdown
You are working in the Antimatter/WebRTC repo.

Task: Update `WEBRTC_IMPLEMENTATION_GUIDE.md` to match implementation discoveries.

Before editing:
- Read the relevant guide section.
- Inspect the implemented code that corresponds to that section.
- Identify only factual inaccuracies, stale paths, missing caveats, or changed implementation details.

Editing rules:
- Keep the guide concise.
- Do not rewrite unrelated sections.
- Do not add aspirational features.
- Prefer repo-relative file paths.
- Clearly distinguish implemented behavior from future recommendations.
- Preserve the existing phase structure unless it is demonstrably wrong.

Verification:
- Re-read the edited section.
- Check markdown formatting.
- If code snippets were changed, ensure they match actual code patterns.

Return:
- Sections changed.
- Reason for each change.
- Any remaining guide uncertainty.
```

## 10. Manual End-to-End WebRTC Test Prompt

```markdown
You are working in the Antimatter/WebRTC repo.

Task: Create and execute a manual verification plan for the WebRTC implementation described in `WEBRTC_IMPLEMENTATION_GUIDE.md`.

Do not change code unless explicitly asked.

Cover:
- Caller starts audio call in a DM.
- Callee receives incoming call toast.
- Callee accepts.
- Both sides exchange offer/answer/ICE successfully.
- Audio works both directions.
- Video can be enabled and disabled.
- Microphone/camera device switching works during a call.
- Hangup works from either side.
- Signaling messages are filtered from Antimatter timeline.
- Regular Mattermost client behavior is documented.
- Refresh during active call triggers recovery behavior.
- Multiple tabs do not duplicate call handling.
- Network change or ICE failure triggers expected recovery or error behavior.

Return:
- Test environment.
- Steps performed.
- Expected vs actual result.
- Logs or symptoms for failures.
- Bugs to file.
```

## Adapter Notes

- For coding agents, use prompts 3–7 one phase at a time and ask the agent to stop after verification.
- For review agents, use prompt 1 before implementation and prompt 8 after implementation.
- For documentation agents, use prompt 9 only after code exists.
- For smaller or faster models, give only one phase prompt at a time and add the exact guide line range or section heading.

## Residual Risks

- The guide is long and includes large code snippets; agents may copy stale snippets instead of adapting to the repo.
- WebRTC behavior requires browser/manual testing that typecheck cannot fully verify.
- Mattermost signaling visibility is a product/privacy trade-off, not only an implementation detail.
- Existing repo build/test commands are not documented in `CLAUDE.md`, so agents must inspect project config before claiming verification.
