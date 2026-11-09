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

The Inject receiver polls every 500 milliseconds only when visible, online, Spotify is connected and a playlist is selected, never overlapping requests, and automatically retries with backoff after errors
Inject test is read only and a changed counter must never trigger duplicate Spotify PUTs; keep last-success indicator tied to actual Spotify acknowledgment

The Inject auto-send path never reads or writes the manual word input, never clicks its submit button and does not render the manual preview, but builds from Inject value directly and PUTs to Spotify

The manual Keep Screen Awake control uses the native Screen Wake Lock API, never loops audio/video, never alters Inject polling, requires user opt-in and shows real activation status, releases when app is hidden and reacquires when visible

Keep the compact wake-lock chip on the Performar view beside the subtitle, not in Settings, and when the preference is saved but lock is inactive a tap must retry rather than disable it

The screen wake-lock preference is saved in localStorage under predify.keep-awake.v1 and automatically retried at startup, while real lock activation remains subject to iOS granting the Screen Wake Lock API request
Only explicit disabling removes the saved preference; a temporary OS rejection must not silently forget the user's choice

If iOS denies an automatic wake lock request, do not discard the saved user preference or falsely mark the screen as protected
Retry synchronously in the next trusted ordinary click, excluding the Settings wake toggle, and never use a timer or polling loop to force iOS wake lock

When the iOS keyboard opens while the manual word input is focused, scroll only the inner scroll-area far enough to show the entire composer and Atualizar playlist button above the keyboard
Never apply this adjustment to other input fields, desktop views, the Inject auto-send path, or the non-keyboard layout

The final keyboard-open position was calibrated on an iPhone as +10 px below the automatically revealed manual composer
Apply this offset only while the iOS keyboard is open and the manual word input is focused, without any temporary overlay or saved calibration state
Keep the composer bottom measurement independent from the translation so reopening the keyboard never cancels the chosen offset
Keep Inject polling, Spotify actions, all other input fields and the keyboard-closed layout unchanged
