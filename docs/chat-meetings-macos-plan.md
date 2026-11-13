# Finish chat with meetings on macOS

Status: selected-meeting slice implemented directly on 2026-11-13. Native UI acceptance remains pending after computer automation failed. The full cross-meeting plan is not complete.
Repository: https://github.com/agonza1/meetily
Branch: enhance/chat-meetings-macos
Current upstream baseline: 9e50dc245157de376b1a9a5b8dcd78a9cde3f2e6 (v0.5.0 plus build/CI fixes). The original fork baseline was 07c4dfd45361bb6776916a0d46f493dda447f471; its planning commit is preserved.

## Outcome

Finish the existing open-source chat contribution for an Apple Silicon macOS first release in this fork. Keep Sidea separate. The user subsequently authorized skipping HumanLayer, which was an optional execution workflow. Continue directly in this fork with appropriate tests, whole-diff review and repository delivery checkpoints. Sidea remains separate.

## Starting point and review

Adopt the focused changes in upstream [PR #810](https://github.com/Zackriya-Solutions/meetily/pull/810), pinning head b86d08999efbd6ee6e8257f764f9a837fc6de7de. Preserve upstream authorship when importing the contribution. Refresh its state before implementation and check whether upstream has merged or superseded it.

- #810: open and unmerged, 14 files, +1076/-14; its head remains b86d08999efbd6ee6e8257f764f9a837fc6de7de. GitHub now reports merge conflicts. A merge-tree dry run against 9e50dc2 found one content conflict in frontend/src/components/Sidebar/index.tsx; the native registration and provider-client changes merged automatically, which does not establish correctness. The November 11 assessment recorded no submitted reviews, check runs or commit statuses on that head. The author's build/test claims have not been reproduced for the chat contribution.
- [#770](https://github.com/Zackriya-Solutions/meetily/pull/770): open and unmerged, 30 files, +1213/-151. Its ask_ai.rs and AskMeetingsModal.tsx blobs are identical to #810; it additionally changes dependencies, build configuration and unrelated audio code. A maintainer acknowledged receipt on September 9, without approving it. Do not import the unrelated changes as part of chat.
- [#497](https://github.com/Zackriya-Solutions/meetily/pull/497): open and unmerged, 18 files, +951/-118. Adds SQLite-backed per-meeting history, chat and note editing, but GitHub reports merge conflicts. Its persistence design may inform a separately reviewed adaptation; do not merge its unrelated template/sidebar/provider changes.

These observations rank adoption readiness; they do not predict upstream maintainers' decisions. No approvals or recent maintainer commitment to merge were found.

## Next bounded slice: selected-meeting chat on macOS

Adopt #810 as attributed source for a working selected-meeting chat, with the basic safety fixes below. This is implementation in this fork, not a competing upstream submission. Upstream contributions target devtest and require coordination; this task does not authorize contacting contributors or opening an upstream PR.

1. Work directly on the existing Meetily branch under the latest user authorization to skip HumanLayer. Preserve the fork boundary and avoid concurrent writers. No HumanLayer task or login is required for this slice.
2. Adapt the reviewed contribution onto the current v0.5.0 baseline while preserving attribution. Resolve the sidebar conflict by retaining the new FeedbackLink and feedback-to-settings navigation as well as the chat entry point. Preserve recording and import controls.
3. Require an explicit selected meeting for this first slice. Do not expose the incomplete all-meetings sampling mode as a finished search feature. Opening the sidebar chat without a selected meeting should prompt the user to choose one. Relevant cross-meeting retrieval is a subsequent slice.
4. Clear or restore only the selected scope's in-memory chat when scope changes. Bind request/results to that scope and invalidate late responses on scope change, reset, close and unmount. An aborted or stale answer must not appear in a later conversation. Durable per-scope history is a separate slice.
5. Bound query/history/context and truncate on valid UTF-8 boundaries. Remove question-content logging. Reuse saved summary provider/model without a chat-induced global model change or automatic external fallback. Load truthful provider/model labels rather than presenting the initial 4B label as selected configuration.
6. Add focused regression tests for explicit scope enforcement, meeting A -> B history isolation, reset/close delayed replies, Unicode and input limits, missing configured models, and preservation of new sidebar navigation. Run the existing relevant frontend and Rust checks and exercise the native Tauri path on Apple Silicon with synthetic notes. Record environment gaps honestly.

Slice completion means a selected-meeting question can receive a local model answer without crossing conversation scope or mutating settings, supported by current-head test and native evidence. It does not establish full cross-meeting recall, persistent chat, clinical suitability or release readiness. Carry the remaining gaps into subsequent slices rather than marking the full plan complete.

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

1. Use the existing agonza1/meetily branch and accepted bounded-slice scope. HumanLayer is optional and skipped under the latest user instruction. Import the focused #810 contribution with authorship preserved onto current main. Keep unrelated cleanup outside this change.
2. Fix scope isolation, stale-result handling, UTF-8 truncation, content logging and model selection. Show actual provider/model and local versus external processing clearly. Chat must not introduce an automatic cloud fallback.
3. Implement bounded, question-relevant transcript chunk selection over the requested meeting set using existing local database/search facilities where practical. Return structured source meeting IDs and timestamps and let the user open the supporting transcript. Disclose limited coverage; return an unsupported answer when evidence is insufficient.
4. Add history keyed by explicit meeting/all-meetings scope using a reviewed SQLite migration and existing persistence conventions. Scope transitions start or restore only that scope's history. Define reset/delete/meeting-deletion behavior; do not persist failed/incomplete assistant messages as completed answers.
5. Complete the macOS UI: keyboard-friendly chat, source navigation, loading/error/retry states and cancellation. Preserve recording/transcription workflows and existing explicit model settings.
6. Run appropriate frontend and Rust checks, whole-diff self-review and native Apple Silicon validation. Produce a fork PR directly (HumanLayer is skipped under the latest user instruction) and report its actual head/checks/findings. No release, installer replacement or upstream PR is included in this task. Standing delivery authorization applies to the fork after required verification and current-head review; retain configured human checkpoints.

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

## Historical November 13 baseline verification (before slice 1)

The fork main branch was fast-forwarded to upstream 9e50dc245157de376b1a9a5b8dcd78a9cde3f2e6. The integration branch preserves its existing plan commit and merges that upstream baseline without conflicts. Its only fork-specific file is this plan; #810 has not been applied to the working tree.

- Installed the committed frontend dependencies with pnpm 9.15.9 and --frozen-lockfile. No dependency manifest or lockfile changed. An initial summary-content test attempt lacked zod before this installation; the completed suite below supersedes that environment failure.
- Bun 1.3.14: bun test tests from frontend passed 65 tests, 0 failures, across 15 files.
- node node_modules/typescript/bin/tsc --noEmit --incremental false passed.
- NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next build passed, generating 12 static pages. Browserslist emitted a stale caniuse-lite-data warning; no dependency update was introduced for that warning.
- git diff --check passed. The refresh diff was reviewed; the imported upstream release was not independently audited in full.
- Rust/native tests, real model inference and Tauri runtime acceptance were not run. Passing frontend checks do not validate the unimported chat PR or complete the selected-meeting slice.
- The HumanLayer CLI still reports Not logged in. A fresh device authorization request expired without completing sign-in; no task or worker was created by this controller.

## Selected-meeting implementation status

The implementation now imports the actual AskMeetingsModal presentation from Muhammed Shareef M (shareefmx), PR #810 at b86d08999efbd6ee6e8257f764f9a837fc6de7de, rather than the earlier minimal replacement view. Chat bubbles, quick suggestions, answer copy, timestamps, loading state and the model/settings footer reuse that source. Our scope-safe hook and native layer remain underneath; this is not a wholesale cherry-pick of the 14-file PR. The upstream head was rechecked and remains open, unmerged and conflicting with main. It does not import the unsafe all-meetings sampling, fuzzy model lookup, silent model changes, screenshots or shared provider rewrites.

Implemented: sidebar and meeting entry points; one-meeting-only native command; scoped transient history; stale request/configuration/draft protection; UTF-8-safe bounded context; no new meeting-content logs; credential-free configuration display; explicit confirmation for configured network providers; read-only model choice; safe Markdown without remote images or active model-generated links; settings deep link.

Verification: native model helper build and Apple Silicon Tauri app bundle build passed. Six context tests and five native SQLite/configuration tests passed inside the full macOS crate. All 83 frontend tests passed, including 18 chat tests and the late-submit draft race. Production Next.js build and TypeScript validation passed. See the slice report for commands and final limitations.

Direct local helper inference with the supported Qwen 3.5 2B Q4_K_M model answered a synthetic checklist question correctly in 8.65 seconds including initial load. Native UI automation could not bind the isolated test app and expired its continuation. No visual or native app-to-model interaction success is claimed. Synthetic test data and a small supported local model were prepared only for a separate test identity; existing Meetily and Sidea profiles were not used.

Remaining: native UI acceptance, production cancellation of model generation, question-relevant transcript retrieval, structured source validation, durable history, and later cross-meeting scope. Closing/resetting currently discards late UI output but may leave the underlying generation running until completion. The code is suitable for a draft review, not a release-readiness claim.
