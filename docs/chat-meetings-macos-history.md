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

Background WebKit screenshot/layout limitations from PR #1 remain; no visual layout approval, physical 8-GB qualification, installer release or production installation is claimed.
