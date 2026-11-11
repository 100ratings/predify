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
Keep the manual pre-send backup fresh and validate the PUT snapshot_id, do not re-read the playlist after sending, cache updates only after an acknowledged write, clear the cache on disconnect or completed new OAuth connection
Cached playlist names, contents and covers may be stale until explicit reload, indicate this in the UI

Diagnostics count HTTP attempts before fetch, responses and network failures separately, never count a cached action or cooldown block as an API request
Keep browser ledgers isolated per runtime to prevent simultaneous tabs overwriting counters, aggregate retained ledgers on export
All telemetry must use allowlisted operation labels and numeric counters, never store URLs, query text, Inject values, playlist identifiers, auth headers or bodies
Remote metrics are persisted in the Durable Object and returned through authenticated status, browser snapshots replace previous server snapshots rather than being added repeatedly
Counter coverage begins at instrumentation deployment, mark possible gaps after interrupted remote checkpoints, never imply these counters are Spotify quota units

Keep diagnosis record/export controls visible, detailed counters and read-only remote test collapsed under Diagnóstico avançado
Do not reintroduce a refresh counters button or direct playlist-link probe without user approval
Hide the remote key form while paired, provide Alterar conexão to reveal it without disconnecting
Poll remote status every 60 seconds when confirmed inactive, retain 2.5 seconds while active, unknown or after an error, and immediate explicit checks on startup, foreground and user actions

Record fixed, allowlisted send-block reasons and readiness transitions without changing send guards or recording words, playlist identity or raw error messages
Force a readiness snapshot when a diagnostic test begins, do not count these local events as HTTP calls
Disabled-button pointer events are best effort, never imply a missing pointer event proves the user did not try to send

Keep the daily Spotify Web API counter independent of diagnostic test recording, sum only spotify attempts from this browser and the latest remote daily snapshot
Exclude spotify-auth, Inject and Cloudflare control calls, preserve daily history for the last 14 calendar days with midnight in America/Sao_Paulo
Expose the daily history in Diagnóstico and exports without new network requests, show remote measurement time and missing or limited coverage rather than claiming complete account-wide totals

Keep the green latest acknowledged Spotify word above the remote presentation, right aligned, covering manual, local Inject and remote sends
Keep a separate persisted gray manual-only confirmation beside the manual initials, remote or local Inject events must never replace that manual history
Only confirmed Spotify writes update success indicators, remote lastValue remains a separate receipt indicator
Do not migrate the legacy combined success into manual history because its origin is unknown

Align all three last-word indicators to the manual composer's inner right edge at desktop and mobile widths
Remote receipt is a separate gray bold line below remote status with the same typography as manual confirmation, long words wrap leftward within each indicator without horizontal overflow

After an acknowledged manual send, clear the submitted manual input and render the empty preview, preserving both latest-success indicators
On failure retain the manual input and preview, never clear a different draft typed during the request or touch the manual composer from Inject or remote sends

Persist the last nonempty remote receipt independently from presentation session state, starting, stopping or expiring a presentation must not clear it
Restore the remote receipt on reopening, replace it only when status supplies another nonempty remote word, never promote it to an acknowledged Spotify success

On cold launch, startup.js sets the idle viewport before body parsing and holds the interface until synchronous local settings and playlist cache restoration finishes
Reveal before awaiting OAuth or any remote response, keep the 3-second fail-open fallback and no-JavaScript visibility, do not add startup Spotify reads or alter the manual keyboard layout
