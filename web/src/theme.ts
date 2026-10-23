import { createTheme } from '@mui/material/styles';

/** Phones and tablets: controls get a 44px minimum so a thumb can hit them. */
const TOUCH = '@media (pointer: coarse)';

/**
 * Material Design theme shared by the panel and the public website. Follows
 * the visitor's light or dark preference unless they pick one (see
 * ThemeModeButton). Every text colour here passes WCAG AA (4.5:1) on the
 * surface it sits on; the comments give the measured ratios.
 */
export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'class' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#0b6bcb' }, // 5.28 on white
        secondary: { main: '#00796b' }, // 5.32 on white
        warning: { main: '#b45309' }, // 5.02 on white, 4.61 on the console's #f5f5f5
        info: { main: '#0277bd' }, // 4.80 on white
        background: { default: '#f4f6f9', paper: '#ffffff' },
      },
    },
    dark: {
      palette: {
        primary: { main: '#6ab7ff' },
        secondary: { main: '#4fd1c5' },
        // White on #f44336 is 3.68, so red buttons take dark text (5.17) like the other dark mode buttons.
        error: { main: '#f44336', contrastText: 'rgba(0, 0, 0, 0.87)' },
        background: { default: '#0f1418', paper: '#161d23' },
      },
    },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: 'Roboto, system-ui, -apple-system, "Segoe UI", sans-serif',
    h4: { fontWeight: 600 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    // Subtitles sit under a page's h1 and a card's h2, so they are h3 (MUI's default h6 skips levels).
    MuiTypography: { defaultProps: { variantMapping: { subtitle1: 'h3', subtitle2: 'h3' } } },
    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        // Anything focusable outside MUI's buttons (links, scroll areas, map markers).
        ':focus-visible': { outline: `2px solid ${theme.vars.palette.primary.main}`, outlineOffset: 2 },
      }),
    },
    // One visible focus ring for every button, tab, chip and list item: primary
    // is 5.28:1 on white and 7.97:1 on the dark paper.
    MuiButtonBase: {
      styleOverrides: {
        root: ({ theme }) => ({
          '&.Mui-focusVisible': { outline: `2px solid ${theme.vars.palette.primary.main}`, outlineOffset: 2 },
        }),
      },
    },
    // Rounded rectangles, never pills.
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 8, [TOUCH]: { minHeight: 44 } } },
    },
    MuiIconButton: { styleOverrides: { root: { [TOUCH]: { minWidth: 44, minHeight: 44 } } } },
    // Player names in tables are buttons styled as links.
    MuiLink: { styleOverrides: { button: { [TOUCH]: { minHeight: 44 } } } },
    MuiToggleButton: { styleOverrides: { root: { [TOUCH]: { minHeight: 44 } } } },
    MuiListItemButton: { styleOverrides: { root: { [TOUCH]: { minHeight: 44 } } } },
    MuiMenuItem: { styleOverrides: { root: { [TOUCH]: { minHeight: 44 } } } },
    // Tabs clip anything outside them, so their ring sits inside.
    MuiTab: { styleOverrides: { root: { '&.Mui-focusVisible': { outlineOffset: -2 } } } },
    MuiCheckbox: { styleOverrides: { root: { [TOUCH]: { padding: 11 } } } },
    MuiRadio: { styleOverrides: { root: { [TOUCH]: { padding: 11 } } } },
    MuiSwitch: { styleOverrides: { root: { [TOUCH]: { marginBlock: 2 } } } },
    MuiCard: { defaultProps: { variant: 'outlined' } },
    MuiPaper: { defaultProps: { elevation: 0 } },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiInputBase: {
      styleOverrides: {
        // MUI fades placeholders to 2.55:1; text.secondary is 5.74:1.
        input: ({ theme }) => ({ '&::placeholder': { color: theme.vars.palette.text.secondary, opacity: 1 } }),
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: ({ theme }) => ({
          // The field itself is what takes the tap, so it grows to 44px, not just its frame.
          [TOUCH]: { minHeight: 44, '&.MuiInputBase-sizeSmall:not(.MuiInputBase-multiline) .MuiInputBase-input': { paddingBlock: '10.5px' } },
          // Field edges need 3:1: 3.36 on white, 3.77 on the dark paper (MUI's default is 1.74).
          '&:not(:hover):not(.Mui-focused):not(.Mui-error):not(.Mui-disabled) .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(0, 0, 0, 0.45)',
            ...theme.applyStyles('dark', { borderColor: 'rgba(255, 255, 255, 0.4)' }),
          },
        }),
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: ({ theme }) => ({
          fontWeight: 600,
          color: theme.vars.palette.text.secondary,
          whiteSpace: 'nowrap',
        }),
      },
    },
    MuiChip: {
      defaultProps: { size: 'small' },
      styleOverrides: {
        root: { borderRadius: 6 },
        // Filter chips are tapped, so they get the touch size; status chips stay small.
        clickable: { [TOUCH]: { height: 44, paddingInline: 4 } },
      },
    },
    MuiPagination: { defaultProps: { shape: 'rounded' } },
    MuiPaginationItem: { styleOverrides: { root: { borderRadius: 8, [TOUCH]: { minWidth: 44, height: 44 } } } },
  },
});

/** Discord's brand colour, for the "Sign in with Discord" buttons. */
export const DISCORD_BLURPLE = '#5865F2';
