# Predify

The user requests Portuguese responses without em dashes or sentence-final periods

Before publishing a functional or visual update:

1. Run `npm run release` to increment the patch version and refresh cache-busting references, or `npm run release -- 1.3.0` for a chosen release
2. Run the relevant tests and `npm run check`
3. Publish all changed release files together, including package.json, version.json, version.js, HTML, updated imports and sw.js
4. Verify deployment and the version shown in Ajustes

Keep the 60-second version check while the app is visible and online, check immediately at startup and when the app becomes visible again, avoid overlapping requests, and never reload automatically during use
The Atualizar o app button applies updates without clearing localStorage, credentials or catalog
Never commit Spotify tokens or Client Secret

Remote presentations use the Cloudflare Worker in cloudflare/, a single authenticated SQLite Durable Object owns each active presentation
When a remote key is configured, suspend the local Inject receiver, never silently fall back while remote status is unknown
Remote start snapshots the existing catalog and opening without modifying saved local data, stop must prevent any further polls or new Spotify writes
Keep test mode strictly read only for Spotify, never send Spotify credentials in test mode
Remote success requires an accepted Spotify PUT with snapshot_id, persist count deduplication and never automatically retry an ambiguous PUT after a restart
Keep both Cloudflare secrets and remote pairing keys out of git, tokens must be encrypted before Durable Object storage

The Inject receiver polls every 500 milliseconds only when visible, online, Spotify is connected and a playlist is selected, never overlapping requests, and automatically retries with backoff after errors
Inject test is read only and a changed counter must never trigger duplicate Spotify PUTs; keep last-success indicator tied to actual Spotify acknowledgment

The Inject auto-send path never reads or writes the manual word input, never clicks its submit button and does not render the manual preview, but builds from Inject value directly and PUTs to Spotify

The wake-lock button is removed from the interface, keep keep-awake.js and its module tests for possible future use
Do not initialize or request wake locks automatically, including on startup, ordinary taps, pageshow or visibility changes
Preserve any previously saved wake-lock preference without activating it
The presentation start and stop buttons share the same rounded shape and typography, retaining distinct action colors and their existing enabled/disabled conditions

When the iOS keyboard opens while the manual word input is focused, scroll only the inner scroll-area far enough to show the entire composer and Atualizar playlist button above the keyboard
Never apply this adjustment to other input fields, desktop views, the Inject auto-send path, or the non-keyboard layout

The final keyboard-open position was calibrated on an iPhone as +10 px below the automatically revealed manual composer
Apply this offset only while the iOS keyboard is open and the manual word input is focused, without any temporary overlay or saved calibration state
Keep the composer bottom measurement independent from the translation so reopening the keyboard never cancels the chosen offset
Keep Inject polling, Spotify actions, all other input fields and the keyboard-closed layout unchanged

Playlist metadata and up to five playlists of cached contents are saved locally, never fetch Spotify playlists automatically on a normal app launch or token refresh
Only an explicit reload, first selection without cached contents, or a completed new OAuth connection should fetch playlist data
Keep manual send backup and verification fresh, cache updates only after an acknowledged write, clear the cache on disconnect or completed new OAuth connection
Cached playlist names, contents and covers may be stale until explicit reload, indicate this in the UI
