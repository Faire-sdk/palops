import { createTheme } from '@mui/material/styles';

/**
 * Material Design theme shared by the panel and the public website. Follows
 * the visitor's light or dark preference (see ThemeProvider in main.tsx).
 */
export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'class' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#0b6bcb' },
        secondary: { main: '#00897b' },
        background: { default: '#f4f6f9', paper: '#ffffff' },
      },
    },
    dark: {
      palette: {
        primary: { main: '#6ab7ff' },
        secondary: { main: '#4fd1c5' },
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
    // Rounded rectangles, never pills.
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { borderRadius: 8 } } },
    MuiCard: { defaultProps: { variant: 'outlined' } },
    MuiPaper: { defaultProps: { elevation: 0 } },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiTableCell: {
      styleOverrides: {
        head: ({ theme }) => ({
          fontWeight: 600,
          color: theme.vars.palette.text.secondary,
          whiteSpace: 'nowrap',
        }),
      },
    },
    MuiChip: { defaultProps: { size: 'small' }, styleOverrides: { root: { borderRadius: 6 } } },
    MuiPagination: { defaultProps: { shape: 'rounded' } },
    MuiPaginationItem: { styleOverrides: { root: { borderRadius: 8 } } },
  },
});

/** Discord's brand colour, for the "Sign in with Discord" buttons. */
export const DISCORD_BLURPLE = '#5865F2';
