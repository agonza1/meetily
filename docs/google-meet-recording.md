# Google Meet recording on macOS (experimental)

Manual recording in Meetily and the menu bar does not require this integration. The compact in-app control shows active recording time (excluding pauses), configured devices, and whether each capture stream opened. An open stream is not proof that it supplied audio. Check permissions and device selection if a source is unavailable or an audio warning appears. Stop uses the normal audio and transcript save flow; wait for finalization to finish before starting another recording.

## Set up detection

This preview targets Google Chrome on macOS with the Google Meet UI in English and a single Chrome profile using the extension. It uses Chrome Native Messaging, not Accessibility, Apple Events, Screen Recording for detection, or an account connection. Meetily still needs its normal macOS audio permissions to record. Get consent before recording participants.

1. Build or install the matching Meetily app. Keep it at a stable path.
2. In Chrome, open `chrome://extensions`, enable Developer mode, and **Load unpacked** from `integrations/chrome-meet` in this checkout. Note the extension ID.
3. From the repository root, register the native host with Node.js. Use the actual absolute executable path inside the matching `.app`, not the app directory:

   ```sh
   node integrations/chrome-meet/install-host.mjs <extension-id> "/absolute/path/to/meetily.app/Contents/MacOS/meetily"
   ```

   The installer does not overwrite an existing manifest. The path is printed on success. The Chrome host registration is per macOS user, not per Chrome profile; use a disposable macOS user for QA if a normal host registration already exists. To uninstall, disable detection, remove the unpacked extension, and remove the registered `com.meetily.google_meet.json` manifest.
4. Under **Settings > Recording**, enable **Detect joined calls**. All three switches are off in a new profile. Start with the automatic switches off.

The extension checks for a Meet room route and two visible in-call controls; lobby and microphone activity alone cannot trigger it. Meet's UI can change, so a different layout or locale can produce no prompt. The integration sends only an opaque, random call token and joined/ended/unknown state to Meetily. No URL, title, participant list, Google credentials, or media are sent. The local private bridge snapshot stops being usable within six seconds without a heartbeat. Using the feature does not change the audio or transcript pipeline.

## Prompt and optional automation

- After several seconds of confirmed joined evidence, Meetily shows a dismissible in-app prompt. If unfocused, it requests Dock attention without stealing focus. Dismissal suppresses that call. **Start recording** is a manual start and is never auto-stopped.
- **Start automatically** and **Stop automatically** are independent opt-ins. A ten-second countdown with **Cancel** and **Start now** or **Stop now** appears in the foreground Meet tab without bringing Meetily forward. If the tab loses focus or the buttons cannot be used, the countdown resets. **Start now** takes manual ownership instead of waiting for the automatic start. Manual stop or cancellation suppresses further automatic starts for the same observed call. The persistent recording controls remain in Meetily and its menu bar.
- Automatic Stop additionally needs at least twenty seconds of continuous end evidence from the same tab (the post-call Rejoin screen) and an exact match to the automatically started recording. Closing the tab, changing focus, muting, losing an audio device, or losing contact with the extension is not positive end evidence. If you close or reload the Meet tab, manage the recording manually; a reload may issue a new detection token. Chrome or macOS throttling can suppress detection or reset a countdown.

## Controlled acceptance checklist

Use an isolated app/profile, approved permissions, one Meetily instance at a time, and disposable rooms with synthetic speech only. Record the exact app revision, Mac and OS build, Chrome version, selected model, configured devices, and timestamps for Start, active capture, Pause/Resume, Stop, and reopening. Record only observations and redacted backend evidence; do not attach audio, transcripts, room links, or permission stores.

1. **MLX baseline, separately:** Use the existing verified MLX preview or exact fork [PR #16](https://github.com/agonza1/meetily/pull/16) revision. In Lightning (MLX), wait for active capture. If it does not start, log the last completed stage and elapsed time; do not count it as a speech or finalization test. Use distinct synthetic phrases at the local microphone and on a remote participant's audio route (use headphones to avoid acoustic bleed). Pause, play two new markers, resume, and play a fresh marker from both sides. Stop, listen for both active routes and absence of paused markers, and reopen the saved final transcript after restart. Use the backend's final-model evidence to distinguish MLX from fallback; a selected model or successful live INT8 model load does not prove MLX ran.
2. **Prompt on the feature head:** Begin with detection off, then turn on detection only. Open Chrome, a Meet landing page, and a disposable room lobby with mic preview; none should prompt. Join, dismiss the prompt, and confirm it does not return in the same call. In a second room confirm a fresh prompt. Accept it and check the startup/active transition, both source indicators, timer, pause/resume, live transcript, manual Stop after leaving, finalization, and reopening. Also try manual Start from the menu bar before joining and check a missing/denied audio source is visible.
3. **Automation on the same head:** Enable either preference separately and check settings after restart. With Chrome foreground, cancel an auto-start countdown and check it does not reappear for the same call. In a fresh room, verify switching tabs or covering the countdown interrupts it; return to the call and let it start without bringing Meetily forward. Mute, sleep briefly, or temporarily disconnect a device and verify there is no duplicate or immediate Stop. Leave via Meet's Leave Call control and keep the post-call page in front. Cancel a Stop countdown and verify capture continues. Repeat with a fresh auto-owned session and let Stop finish, then verify the recording and transcript. A manually started recording must not auto-stop, even with both preferences on.

Related upstream work: [#875](https://github.com/Zackriya-Solutions/meetily/pull/875) uses process audio activity and front-tab URLs; [#666](https://github.com/Zackriya-Solutions/meetily/pull/666) uses window titles and calendar access; [#733](https://github.com/Zackriya-Solutions/meetily/pull/733) uses process and tab presence. This fork feature checks joined controls within the Meet tab instead. See also [#761](https://github.com/Zackriya-Solutions/meetily/issues/761) and [#218](https://github.com/Zackriya-Solutions/meetily/issues/218).
