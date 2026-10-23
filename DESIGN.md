# PalOps design direction

Status: draft. It records what the owner has decided and what the code does today. The open questions at the end are the owner's to answer; until then, the "In the code" choices stay as they are and nothing new is invented on top of them.

## Decided by the owner

- No pills anywhere. Buttons are rounded rectangles with 8px corners, chips 6px.
- Say "IP", not "address", for player and ban IPs. People know the word.
- PalBan Network and PalDefender stay out of sight unless their integration is on.
- Integrations share information about cheaters with proof. They never decide who plays on another server.
- The public site shows only what the server and its staff wrote: no stand-in description, no default rules.

## Accessibility rules (from antislop audit 001)

These hold for every screen, in light and dark:

- Text meets 4.5:1 against its background, large text 3:1. Check new colors with a contrast checker, do not judge by eye.
- Every control shows the 2px primary focus ring when reached by keyboard (set once in `web/src/theme.ts`).
- On touch screens, controls are at least 44px tall (`@media (pointer: coarse)` in the theme).
- Text field edges meet 3:1.
- Status color always comes with words ("Online", "Banned", "Verified"), never color alone.
- A missing value says what is missing ("Unknown", "None", "Never"), never a dash.
- Anything that opens on hover also opens on focus or tap.

## In the code (no reason recorded yet)

| Choice | Value |
| --- | --- |
| Primary | `#0b6bcb` light, `#6ab7ff` dark |
| Secondary | `#00796b` light, `#4fd1c5` dark |
| Status | green online or good, red offline or banned, amber needs a look, blue info |
| Typeface | Roboto (MUI's default) |
| Surfaces | outlined cards, no shadows, 12px card corners |
| Theme | follows the device, with a light, dark or device switch in the header |
| Public site hero | plain page background; the radial glow was removed (antislop audit 003) |

## Open questions for the owner

1. Brand color: keep the blue, or use a color of your own?
2. Typeface: keep Roboto, or pick one that fits PalOps's character?
3. Three words for how PalOps should feel to staff and to players.
4. The public site: one PalOps look for every server, or an accent color each server owner sets?
