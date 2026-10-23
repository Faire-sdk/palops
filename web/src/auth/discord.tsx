import Button, { type ButtonProps } from '@mui/material/Button';
import SvgIcon, { type SvgIconProps } from '@mui/material/SvgIcon';
import { DISCORD_BLURPLE } from '../theme';
import type { User } from '../api/types';

/** Messages for the `auth_error` codes the Discord callback redirects with. */
export function authErrorMessage(code: string | null, discordId?: string | null): string | null {
  switch (code) {
    case null:
      return null;
    case 'not_authorized':
      return discordId
        ? `Your Discord account isn’t on this panel yet. Send your Discord ID (${discordId}) to a panel owner so they can add you.`
        : 'This account isn’t allowed to sign in. Ask a panel owner for access.';
    case 'invalid_state':
      return 'That sign-in link expired or was opened in another browser. Please try again.';
    case 'cancelled':
      return 'Discord sign-in was cancelled.';
    case 'setup_done':
      return 'Setup has already been completed. Sign in instead.';
    case 'discord_in_use':
      return 'That Discord account is already linked to another panel user.';
    default:
      return 'Discord sign-in failed. Please try again.';
  }
}

const CDN = 'https://cdn.discordapp.com';

/** Discord's picture for the user, or the default one Discord shows when they haven't set one. */
export function discordAvatarUrl(discord: NonNullable<User['discord']>, size = 64): string | null {
  if (discord.avatar) return `${CDN}/avatars/${discord.id}/${discord.avatar}.${discord.avatar.startsWith('a_') && size > 64 ? 'gif' : 'png'}?size=${size}`;
  try {
    return `${CDN}/embed/avatars/${Number((BigInt(discord.id) >> 22n) % 6n)}.png`;
  } catch {
    return null;
  }
}

export const discordBannerUrl = (id: string, banner: string, size = 600) => `${CDN}/banners/${id}/${banner}.${banner.startsWith('a_') ? 'gif' : 'png'}?size=${size}`;

export const discordGuildIconUrl = (id: string, icon: string, size = 64) => `${CDN}/icons/${id}/${icon}.png?size=${size}`;

export function DiscordLogo(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M20.32 4.37A19.8 19.8 0 0 0 15.4 2.84a13.9 13.9 0 0 0-.63 1.29 18.4 18.4 0 0 0-5.53 0 12.6 12.6 0 0 0-.64-1.29 19.7 19.7 0 0 0-4.93 1.53C.54 9.05-.32 13.62.1 18.12a19.9 19.9 0 0 0 6.04 3.05c.49-.66.92-1.36 1.29-2.1a12.9 12.9 0 0 1-2.03-.97c.17-.12.34-.25.5-.38a14.2 14.2 0 0 0 12.2 0c.16.13.33.26.5.38-.65.39-1.33.71-2.04.98.37.73.8 1.43 1.29 2.09a19.8 19.8 0 0 0 6.05-3.05c.5-5.22-.85-9.75-3.58-13.75ZM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.95-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.22 0 2.18 1.1 2.16 2.42 0 1.34-.94 2.42-2.16 2.42Z" />
    </SvgIcon>
  );
}

/** A button in Discord's colours with its logo. */
export function DiscordButton({ sx, ...props }: ButtonProps & { target?: string; rel?: string }) {
  return (
    <Button
      variant="contained"
      startIcon={<DiscordLogo />}
      sx={{ bgcolor: DISCORD_BLURPLE, color: '#fff', '&:hover': { bgcolor: '#4752c4' }, ...sx }}
      {...props}
    />
  );
}
