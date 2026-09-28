# Player accounts, profiles and playtime

## Signing in and linking a character

Players sign in on the public website with Discord and link their in-game character by name or platform ID. The link is a **claim** until it's verified (see
[discord-bot.md](discord-bot.md#linking-players-roles-and-joining-the-server)): an **in-game code** through PalDefender, or **approval by an admin**. A verified
link is what earns Discord roles and lets bans follow the person. An unverified claim is shown as "Not verified yet" and can be taken over by whoever proves the character is theirs.

Staff see the link on a player's profile and can verify or remove it, and the **Link requests** tab lists players who asked staff to confirm. All of it is audited.

## The public website

When the server publishes its player list (`SITE_SHOW_ONLINE_PLAYERS`, on by default):

- **Players** lists everyone who has played, searchable and sortable by recent activity, playtime, level or name, with a verified badge and who's online.
- Each player has a **profile page**: level, time played, visits and longest visit, their strongest pals, their guild (members, online, bases), and when they started.
  Profiles use an internal number in the address, so platform IDs never appear in a URL, and there are no IP addresses anywhere.
- A player's **Discord name** is shown only if the link is verified **and** they switch on "Show my Discord name on my public profile" on their account page.
- The account page shows the player's own stats, the verification steps, and a link to their public profile.

## Playtime

PalOps records a **visit** whenever a player is seen online and ends it when they're not, from the online list it already checks (about once a minute, and whenever a page asks).
So playtime has roughly one-minute resolution and can be slightly short, a visit is ended when the server becomes unreachable (so a restart isn't counted as playing), and only
time from when PalOps started watching is counted. Visits older than a year are dropped.

## In the panel

- **Players → Online** shows each player's playtime and a badge for a linked Discord account (a tick when verified).
- **Players → All players** can be filtered (online, banned, has a Discord link, verified, not verified) and sorted (recently seen, playtime, level, name), and shows playtime.
- A player's profile adds **Activity** (playtime, visits, average and longest visit, recent visits) and a **Discord** section with the linked account and its verification.
