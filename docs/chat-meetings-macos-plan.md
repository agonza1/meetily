# Finish chat with meetings on macOS

Status: planning prepared on 2026-11-11. Implementation has not started in HumanLayer.
Repository: https://github.com/agonza1/meetily
Branch: enhance/chat-meetings-macos
Base: 07c4dfd45361bb6776916a0d46f493dda447f471 (upstream main at fork creation)

## Outcome

Finish the existing open-source chat contribution for an Apple Silicon macOS first release in this fork. Keep Sidea separate. Use the configured HumanLayer installation and its stock project/task/session workflow for implementation, verification and PR delivery. Preserve repository and workflow human checkpoints.

## Starting point and review

Adopt the focused changes in upstream [PR #810](https://github.com/Zackriya-Solutions/meetily/pull/810), pinning head b86d08999efbd6ee6e8257f764f9a837fc6de7de. Preserve upstream authorship when importing the contribution. Refresh its state before implementation and check whether upstream has merged or superseded it.

- #810: open and unmerged, 14 files, +1076/-14; GitHub reports mergeable. No submitted reviews, check runs or commit statuses were observed on its head. The author's build/test claims were not reproduced in this assessment.
- [#770](https://github.com/Zackriya-Solutions/meetily/pull/770): open and unmerged, 30 files, +1213/-151. Its ask_ai.rs and AskMeetingsModal.tsx blobs are identical to #810; it additionally changes dependencies, build configuration and unrelated audio code. A maintainer acknowledged receipt on September 9, without approving it. Do not import the unrelated changes as part of chat.
- [#497](https://github.com/Zackriya-Solutions/meetily/pull/497): open and unmerged, 18 files, +951/-118. Adds SQLite-backed per-meeting history, chat and note editing, but GitHub reports merge conflicts. Its persistence design may inform a separately reviewed adaptation; do not merge its unrelated template/sidebar/provider changes.

These observations rank adoption readiness; they do not predict upstream maintainers' decisions. No approvals or recent maintainer commitment to merge were found.

## Confirmed gaps in #810

Source: [backend at reviewed head](https://github.com/shareefmx/meetily/blob/b86d08999efbd6ee6e8257f764f9a837fc6de7de/frontend/src-tauri/src/summary/ask_ai.rs) and [chat component](https://github.com/shareefmx/meetily/blob/b86d08999efbd6ee6e8257f764f9a837fc6de7de/frontend/src/components/AskMeetingsModal.tsx).

1. Cross-meeting answers use the first 15 returned meetings, up to 1500 bytes of each summary and five initial transcript segments. This is limited sampling, not question-relevant retrieval over the full collection. Single-meeting context also truncates early transcript text, losing later decisions. Summary/history/query sizes are not consistently budgeted.
2. Scope changes retain the same chat history. The frontend sends that history to the backend with the new meeting ID, so a question for meeting B can include content from meeting A. Reset/close/scope changes also need protection against late replies from an earlier request.
3. Summary truncation uses &md[..1500], which can panic when byte 1500 is inside a multibyte UTF-8 character.
4. The command logs the full question at info level. Remove content-bearing logs and verify errors/logging do not expose transcripts or conversation history.
5. Answers return only text/provider/model; source IDs and timestamps are not structured or validated. A prompt requesting citations is not sufficient evidence grounding.
6. Chat is component state only; no per-scope durable history. Add scoped persistence with deletion behavior before presenting conversation history as durable.
7. The command can silently switch the built-in model and save the replacement globally. Its size threshold is not an integrity check. Use existing verified model management, fail clearly for unavailable models and avoid changing user settings as a side effect of asking a question.
8. No dedicated chat test files were added. The UI waits for a full response; generation cancellation and macOS end-to-end behavior remain unverified.

## Model behavior

Chat inherits the saved summary provider/model; it does not have a separate authoritative default. #810 initially labels the UI Built-in AI / Qwen 3.5 4B before loading saved settings, which can be misleading.

Current upstream onboarding saves builtin-ai with its recommended local model. The actual recommend_summary_model implementation chooses qwen3.5:4b when detected RAM is >=14 GiB (the effective floor intended for nominal 16-GB machines), otherwise qwen3.5:2b. The older platform-specific comment in commands.rs is stale. Both use Q4_K_M GGUF files: approximately 2614 MB and 1221 MB respectively. Qwen 3.5 4B is the quality-oriented macOS starting choice where RAM permits; keep the smaller model available and measure real performance. Honor an existing explicit user selection rather than overwrite it.

Transcription is independent: fresh onboarding selects parakeet-tdt-0.6b-v3-int8. It is not the chat model. Existing users may select other supported transcription or summary providers.

## Implementation sequence

1. In HumanLayer, create/reuse the exact project bound to agonza1/meetily, inspect existing tasks, and create one accepted task with an isolated workspace and task-specific branch. Import the focused #810 contribution with authorship preserved onto current main. Keep unrelated cleanup outside this change.
2. Fix scope isolation, stale-result handling, UTF-8 truncation, content logging and model selection. Show actual provider/model and local versus external processing clearly. Chat must not introduce an automatic cloud fallback.
3. Implement bounded, question-relevant transcript chunk selection over the requested meeting set using existing local database/search facilities where practical. Return structured source meeting IDs and timestamps and let the user open the supporting transcript. Disclose limited coverage; return an unsupported answer when evidence is insufficient.
4. Add history keyed by explicit meeting/all-meetings scope using a reviewed SQLite migration and existing persistence conventions. Scope transitions start or restore only that scope's history. Define reset/delete/meeting-deletion behavior; do not persist failed/incomplete assistant messages as completed answers.
5. Complete the macOS UI: keyboard-friendly chat, source navigation, loading/error/retry states and cancellation. Preserve recording/transcription workflows and existing explicit model settings.
6. Run appropriate frontend and Rust checks, whole-diff self-review and native Apple Silicon validation. Produce a fork PR through the HumanLayer workflow and report its actual head/checks/findings. No release, installer replacement or upstream PR is included in this task. Standing delivery authorization applies to the fork after required verification and current-head review; retain configured human checkpoints.

## Acceptance evidence

- A long meeting question about a decision near its end retrieves the correct timestamped evidence.
- A collection larger than 15 meetings retrieves a relevant older meeting; excluded meetings never enter current-meeting context.
- Meeting A -> B, all -> selected, reset, close/reopen and delayed-response cases preserve scope and reject stale output.
- Non-ASCII text crossing truncation boundaries cannot panic; oversized query/history/context receives bounded handling.
- Answers cite real included meeting/segment identifiers; unsupported questions abstain instead of fabricating source support. Transcript instructions cannot alter selected scope or provider settings.
- Per-scope history survives restart; reset/delete and deletion of a meeting have defined, tested behavior.
- Missing/download-incomplete models fail clearly without silently changing global settings. Actual provider/model labels match execution. Local model mode sends no meeting text to an external provider.
- New chat tests pass alongside affected existing tests; report native build/run evidence separately from author claims or mock results.
- On Apple Silicon, measure cold/warm time to first visible output and completion, peak memory and cancel behavior for available 2B/4B models. Record hardware and model identity. No unsupported speed/quality claim.

## Handoff blocker

The configured HumanLayer API is reachable, but the stock CLI cannot refresh its saved login and reports Not logged in. No HumanLayer task/session has been created. Reauthenticate the configured installation, then inspect projects/tasks before publishing this scope. Do not select another installation or bypass the managed workflow.
