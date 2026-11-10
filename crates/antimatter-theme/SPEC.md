---
id: antimatter-theme
type: module-design
title: Antimatter theme tokens
status: active
parent: antimatter
---

# Theme contract

`antimatter-theme` owns Antimatter's visual tokens and exposes them only as a
`rune_kit::Kit` per `Theme` (Default, Light, HighContrast, Warm). Semantic names
and the default/light values come from
[design tokens](../../docs/swiftui-recreation/appendix/design-tokens.md), which
remains the authority; change values there first. Every `Kit` field is set
explicitly; nothing derives from `Kit::neutral` or `Kit::from_palette`, and the app
does not use `rune::tok` for colour, type or motion.

- Components come from `rune-kit` (Button, Switch, SegmentedControl, Sidebar,
  TextInput). Their geometry is kit-owned; this crate only supplies tokens. Write an
  Antimatter component only where a kit component visibly clashes.
- Type is 14 pt base with 11-12 pt metadata; radii 4/6/8; motion uses Rune's
  `SNAP` (0.25 s) and `SETTLE` (0.3 s) springs so at-rest frames settle.
- High-contrast and Warm values beyond the documented anchors are proposals pending
  design review.
- The crate depends only on `rune` and `rune-kit`. Its test asserts documented
  default tokens and minimum contrast for text, secondary, muted, border and selected
  row in every theme. `task verify` renders every theme through `scripts/ui-lint.py`.
- Theme selection is `State::theme` in `antimatter-app`; no settings UI or persistence
  exists yet (singleton native Settings is outstanding under #4).
