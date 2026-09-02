# Design Tokens

## Color tokens

- **App background:** default `#111113`; light `#f8fafc`; workspace base.
- **Panel:** default `#18191b`; light `#ffffff`; header, sidebar, and modal surface.
- **Raised:** default `#212225`; light `#eef3f8`; controls and hoverable surfaces.
- **Hover:** default `#272a2d`; light `#e2eaf3`; hover/focus-adjacent fill.
- **Subtle border:** default `#363a3f`; light `#d3dce7`; separators.
- **Strong border:** default `#43484e`; light `#aebccd`; input/control edge.
- **Primary text:** default `#edeef0`; light `#101827`; primary copy.
- **Secondary text:** default `#b0b4ba`; light `#334155`; secondary copy.
- **Muted text:** default `#777b84`; light `#64748b`; metadata.
- **Accent:** default `#46a758`; light `#278747`; send and positive actions.
- **Warm:** default amber 9; light `#b87503`; mention/attention.
- **Danger:** default red 11; light `#a11c24`; failure.

## Metrics

- Base font: 14 pt; metadata: 11–12 pt; compact labels: 10–11 pt.
- Radius: 4 pt code/inline, 6 pt rows/chips, 7 pt controls, 8 pt panels, 999 pt pills/dots.
- Standard gaps: 2, 4, 6, 8, 10, 12, 16 pt.
- Row height: channels 30 pt; toolbar actions 22–24 pt; send 34 pt.
- Borders: 1 physical point; own-message marker 2 pt; mention marker 3 pt.

High contrast uses near-black base, `#ffffff` primary text, stronger dividers. Warm uses `#171512` base, brown panels, amber/orange accent, and warm link color. Keep semantic names stable so all components adapt automatically.
