---
name: nibware-ui-components
description: Use when designing or implementing frontend UI components, screens, or flows in this project and Nibware components could provide a starting point. Browse https://nibware.dev/components/all?type=component, select a fitting native SwiftUI component, then adapt it to the existing product and the project’s Premium Utilitarian Minimalism & Editorial UI design protocol. Do not use for backend-only, data-model, or non-UI tasks.
---

# Nibware UI Components

Use Nibware as a source of native SwiftUI component implementations, not as a mandate to import a complete design unchanged.

## Workflow

1. Read the target surface and the adjacent UI before choosing a component. Reuse an existing project component or platform control if it already covers the need.
2. Browse [Nibware Components](https://nibware.dev/components/all?type=component) using the task’s UI type and interaction as search terms.
3. Select the smallest component that supplies the required structure or interaction. Fetch its source with the available Nibware component tool only after selection.
4. Integrate the minimum necessary source into the existing feature. Preserve established state flow, accessibility behavior, platform conventions, and project naming.
5. Adapt the component to the project design protocol rather than copying its visual defaults.
6. Verify the target interaction and build after integration. Do not add a dependency solely to use a Nibware component.

## Design Protocol

Apply Premium Utilitarian Minimalism & Editorial UI:

- Use warm white or off-white canvases, white or near-white surfaces, off-black body text, muted secondary text, and `1px solid #EAEAEA` structural borders.
- Establish hierarchy with typography and whitespace before adding decoration. Use system-native or project typography and tight editorial display headings only where appropriate.
- Keep cards flat with 8–12px maximum corner radii and no visible heavy shadows. Do not use gradients, glassmorphism, neon colors, large bright-color backgrounds, or oversized pill containers.
- Use restrained, desaturated pastel accents only for semantic states, tags, or small icon backgrounds; color must not replace hierarchy.
- Prefer platform-native controls and symbols. Do not introduce a generic icon library when SF Symbols or existing project assets cover the need.
- Ensure controls have explicit labels, keyboard support where applicable, sufficient contrast, and clear hover, focus, disabled, and pressed states.
- Keep motion quiet and purposeful. Prefer opacity and transform animation, respect Reduce Motion, and do not animate layout properties.
- Use specific product copy and realistic contextual content. Avoid placeholder names, lorem ipsum, emojis, and generic AI-marketing language.

## Selection Rules

- Do not add UI merely because a Nibware component exists.
- Prefer adapting layout, spacing, color, and typography over replacing the project’s interaction model.
- Use the smallest useful Nibware source slice; remove demo-only data, preview scaffolding, and unrelated variants.
- Keep native macOS behavior native: use SwiftUI and AppKit conventions already present in the target area.
- If no Nibware component fits cleanly, implement the minimal UI with SwiftUI primitives instead.
