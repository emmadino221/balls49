# Emmy-Bet Pro / Balls49

Start with [Current architecture and operations](docs/00-current-architecture.md).
It separates current local behavior from historical implementation reports and
live settings that must be checked on the server.

This repository contains the Balls49 collector and prediction worker, the
React website, the Balls49 Chrome extension, the BetZero research lab and real
football services. The virtual-football generator and its extension live in
the sibling [virtual 2 mobile repository](../virtual%202%20mobile/README.md).

## Documentation

- [Current architecture, prediction rules and documentation map](docs/00-current-architecture.md)
- [Website automation and membership](docs/26-website-automation.md)
- [Real football, including the team-strength model](docs/23-football-preview.md)
- [Virtual football markets and feed](docs/29-virtual-football-markets.md)
- [Backups and recovery limitations](docs/28-google-drive-backups.md)
- [Owner security and vault recovery](docs/27-security-and-owner-2fa.md)

Older documents preserve implementation history. Their old deployment commands,
test counts and enabled/disabled statements are not a current release manifest.
No service should be started merely to inspect this repository: startup can
write state, apply migrations or perform scheduled work.
