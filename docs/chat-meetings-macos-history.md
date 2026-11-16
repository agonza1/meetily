# Saved selected-meeting conversations

This slice builds on merged [fork PR #1](https://github.com/agonza1/meetily/pull/1). It saves the latest 20 completed question/answer exchanges per meeting in the existing local SQLite database. Reopening chat or restarting the app restores the selected meeting's messages, original provider/model labels, timestamps and exact source quotations. The notes editor, model defaults and recording/transcription paths are preserved.

## Lifecycle

- A completed native answer is saved after source validation. A single exchange row contains both question and answer; no pending or failed assistant output is stored. A reply already committed before a close/Stop action is completed history and can reappear when history is reloaded.
- Native generation loads its bounded context from saved history rather than trusting caller-supplied message text. The existing six-message/6,000-byte prompt budget remains separate from the 20-exchange display retention. Saved messages are not all guaranteed to enter the model context.
- Each conversation has a revision. Saving compares the revision and advances it transactionally. Clear saved chat advances that revision and removes only the selected meeting's exchanges. Concurrent or late replies based on the old revision cannot restore cleared history.
- Changing, adding or removing transcript text/timing invalidates saved source evidence and advances the revision. Re-transcribing a meeting therefore starts a fresh conversation. Editing notes or generating summaries does not clear chat. This is stated in the chat footer.
- Deleting a meeting cascades both its conversation record and exchanges through existing foreign-key behavior. No new history records can be created for a deleted meeting.
- Stop cancels the native request, then reloads the committed history/revision before another question is enabled. An editable draft is preserved during that reload. Clear failures keep sending disabled; model-settings failure after a successful clear reports the partial success truthfully.
- History loading, clearing and reply handling stay bound to the current meeting and conversation epoch. A delayed A load/clear cannot replace B's messages. Provider confirmation remains required for each question using a configured network endpoint; loading history itself performs no model or network request.

## Implementation

One forward SQLite migration adds conversation/exchange tables, a scope index and transcript invalidation triggers. It does not rewrite existing meetings, transcripts, summaries, handwritten notes or settings. Retention pruning and append occur in one transaction. Duplicate requests and stale revisions cannot leave half an exchange or an advanced revision without a saved answer.

`api_get_meeting_chat_history` and `api_clear_meeting_chat_history` expose scoped history. `api_ask_meetings_ai` additionally requires the loaded `historyRevision` and returns the committed revision and timestamp. The frontend and native command callers are updated together. History/source data is never added to logs. The temporary native acceptance harness is removed before publication.

Related work: upstream [#497](https://github.com/Zackriya-Solutions/meetily/pull/497) also adds history alongside broader UI/template/provider changes. This continues the user-owned fork's scoped implementation, uses its existing #810-adapted chat UI and does not submit a competing upstream PR.

## Verification

On Apple Silicon macOS:

- 96 frontend tests passed, including saved-history restore, late load/clear scope races, clear failure, clear/model-settings partial success and the Stop/commit boundary.
- 328 native tests passed, including nine history tests covering file-backed restart, migration from the previous schema, retention, revision conflicts, cancelled/duplicate saves, transcript invalidation and meeting deletion. Four existing manually gated native tests remained ignored.
- TypeScript, the production frontend build and a clean isolated macOS app bundle build passed. Whole-diff self-review and `git diff --check` passed.
- Real native functional UI checks used synthetic A/B meetings, the previous schema and the actual local Gemma E2B model. Verified a completed pair saved with exact source metadata, restoration after closing and after killing/restarting the app, A/B isolation, clear A preserving B, clear while generating, cancelled output not saved, an editable draft after Stop and invalidation after a transcript edit. Existing handwritten notes and the explicit model setting survived migration.
- Model settings unavailable: saved messages remain readable, and generation stays disabled. This behavior is covered by the hook tests.
- The temporary UI harness was removed from source and the final binary before publication. Evidence is scoped under `/Users/alberto/Codex/Evidence/meetily-history-20261115`.

The history-only slice above did not qualify visual layout, physical 8-GB hardware, an installer release or production installation.

## Inline meeting screen

The initial inline meeting screen replaced the summary-context box with **Ask about this meeting**. Suggested questions above the input prefill an editable draft; the arrow on its right sends it. Answers, sources, copy, Stop, clear history and provider confirmation use the existing scoped chat service. The separate Ask meeting buttons, meeting picker and modal are removed.

Use the pencil beside a transcript passage to correct it, then Save transcript or Cancel. Saving retains its timestamp, rejects stale edits, clears obsolete chat and reloads the corrected text. Existing summaries remain available; regenerate to include corrections. Editing is unavailable while a summary is generating. No dependency or database migration is added.

Inline UI verification on Apple Silicon macOS: 98 frontend tests and 330 native tests passed (four existing ignored), TypeScript and production frontend build passed. Actual native Gemma E2B checks covered suggestion prefilling, sourced answering, correction from Friday to Monday, regenerated summary and subsequent answer using Monday, Cancel, Stop/draft retention, meeting isolation, clear during generation, and restoration after process restart. Native captures at 1100×700 and 740×650 verified the updated layout. The 15 imported Krisp meetings (1,103 turns) stayed unchanged in their separate user test profile. Physical 8-GB and non-macOS qualification remain outside this slice.


## Floating meeting questions

Meeting details now has a floating **Ask anything…** bar. Click it to open a compact popover with **What was decided?** and **List action items**; these prefill the question rather than sending automatically. The launcher stays available on both narrow-screen tabs. Transcript editing temporarily hides it and reloads corrected history afterward.

The existing selected-meeting service, saved answers, source quotations, copy, clear, Stop and remote-provider confirmation remain in use. Escape, outside click or Close dismisses the popup, preserves the draft and cancels unfinished generation. Completed answers restore on reopening. Saved provider/model changes remount the chat configuration. No backend, model default, dependency or schema change is required.

Verification on Apple Silicon macOS: 99 frontend tests passed; TypeScript and the production frontend build passed. The actual Tauri popup passed native checks for focus, Escape/outside closing, retained drafts, two prompts, a real local Gemma E2B sourced answer, close cancellation, transcript correction and both tabs at 740×650. Desktop and narrow native captures are under /Users/alberto/Codex/Evidence/meetily-floating-20261116. All 15 Krisp meetings and 1,103 transcript turns remained in the separate user test profile.
