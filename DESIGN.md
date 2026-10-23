# PalOps design direction

Status: direction set by the owner. It records what the owner has decided and what the code does today. Nothing here was invented on the owner's behalf; new choices go to the owner first.

## Decided by the owner

- **Primary color: Harbor, a muted navy.** `#24527a` in light mode (8.19:1 on white, 7.57:1 on the page background) and `#8bb8e8` in dark mode (8.20:1 on cards, 8.93:1 on the page). Chosen from four checked options for calm, precise and trustworthy; it stays clear of the green, red and amber status colors.
- **Personality: calm, precise, trustworthy.** Quiet surfaces, one accent color used where it matters, exact wording, no decoration that claims more than the product does.
- **Typeface: Roboto.** Kept on purpose: plain and easy to read at the small sizes a dense panel needs.
- **Each server sets its own website color** under Settings, Website. The staff panel keeps PalOps colors. The public website uses the server's color in a shade that stays readable (4.5:1) in light and dark mode, and shows the server's staff both shades before they save.
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
- Button text is white or black, whichever reaches 4.5:1 on the button color (the theme's `contrastThreshold`).

## In the code (no reason recorded yet)

| Choice | Value |
| --- | --- |
| Secondary | `#00796b` light, `#4fd1c5` dark |
| Status | green online or good, red offline or banned, amber needs a look, blue info |
| Surfaces | outlined cards, no shadows, 12px card corners |
| Theme | follows the device, with a light, dark or device switch in the header |
| Public site hero | plain page background; the radial glow was removed (antislop audit 003) |

## Color options that were considered

The owner picked A from these, suggested on request and each checked for contrast. The rest stay here for reference.

| Option | Light mode | Dark mode | On white | On dark cards | Notes |
| --- | --- | --- | --- | --- | --- |
| A. Harbor | `#24527a` | `#8bb8e8` | 8.19:1 | 8.20:1 | Muted navy. Calm and steady; clearly apart from the green, red and amber status colors. |
| B. Lagoon | `#0b6b66` | `#5cc6bb` | 6.35:1 | 8.31:1 | Deep teal, like island water. Sits near PalBan Network's teal and a little near the green "online" color. |
| C. Ink | `#1f3a5f` | `#9cc3f0` | 11.48:1 | 9.30:1 | Deep navy. The most precise and serious; buttons read heavier. |
| D. Current blue | `#0b6bcb` | `#6ab7ff` | 5.28:1 | 7.97:1 | Brighter. Close to the stock Material blue, so it says least about PalOps. |
