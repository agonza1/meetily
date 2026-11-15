# macOS notes and selected-meeting chat MVP

Historical PR #1 report. The [saved-conversation slice](chat-meetings-macos-history.md) adds durable per-meeting history after this baseline.

The MVP extends main's existing summary pipeline and the attributed #810 chat adaptation. It preserves recording/transcription, the editable notes UI, existing summary caches and custom templates.

- Standard notes retain Summary, Key Decisions, Action Items and Discussion Highlights. Prompts distinguish proposals from agreed tasks, preserve corrections and require rows for agreed unassigned tasks. Missing owners/dates use `Not specified`; missing source references use `Not supplied`. Existing saved notes and custom templates are not rewritten.
- Selected-meeting chat scans all nonempty transcript rows locally through overlapping 1,200-byte UTF-8 windows. A bounded lexical ranker keeps 24 candidates; relevant ties prefer later corrections. For queries without lexical matches, deterministic overview sampling includes the end. Selected evidence is restored to transcript order. Context remains bounded to 14,000 bytes and partial coverage is disclosed. Follow-ups include the preceding user question in lookup terms.
- The model returns answer/source JSON. Native code rejects malformed responses, unknown source numbers and quotations absent from the supplied excerpt. It resolves segment IDs and timestamps from SQLite. The chat exposes exact quotations in expandable Transcript sources; the existing Open transcript action remains available. Empty source lists become an unsupported-answer response. This checks provenance, not semantic entailment of every model claim. An unsupported question may also receive a retryable source-validation error. Keyword lookup is not semantic or phonetic search and may miss paraphrases.
- Stop, reset, close and meeting changes cancel the pending request. Existing native cancellation stops local helper work; for network providers it abandons the HTTP request, which does not guarantee that remote computation stops. Requests sharing the built-in helper are serialized so cancelling a queued chat cannot terminate another meeting's active summary. Early cancellation and stale frontend responses remain isolated by request UUID/conversation epoch.
- Built-in text-only Gemma 4 E2B/E4B Q4_K_M options use pinned GGUF revisions and the official non-thinking turn format, with greedy decoding. macOS onboarding recommends E4B above 8 GiB. Through 8 GiB it retains the existing Qwen 3.5 2B recommendation until physical low-memory Gemma qualification; Gemma E2B remains manually selectable. Automatic available-model selection uses the same low-memory guard. Existing saved model/provider settings are preserved; other platforms retain their existing Qwen RAM recommendation. These models use an 8,192-token application context, independent of the OpenRouter Qwen tool's context. No media projector or encoder is downloaded.
- The helper retains model weights between requests and prefills in batches of at most 512 tokens instead of allocating a context-sized token batch. Context capacity is preserved; oversized tokenized prompts fail explicitly. Byte limits do not guarantee token fit for every language.

No RapidFuzz, embedding database, phonetic dependency, cloud lookup, new inference runtime, schema migration, all-meetings chat or durable conversation history is introduced. These are scoped notes/chat improvements, not a release-readiness claim.

## Model artifacts and qualification

Public files checked against Hugging Face metadata and SHA-256 locally:

| Model | Revision | File bytes | SHA-256 |
| --- | --- | ---: | --- |
| E2B | 0314792d7f1f7e229411f620751375812bb9faf2 | 3106738272 | 740185b21d22ceb83a11c3aa62ad5842ef32c70f6096d756bbee85a1e4ec34b8 |
| E4B | bfc15c382204943c3a8fff0c750b94ae2364d7a3 | 4977171584 | 85a896a047553e842f25297ee5b031d64ff30147d9c4af17b1e4b394cd1fab87 |

The existing model manager still uses its upstream size-based download validation; this change does not claim cryptographic validation in the app. No model weights are committed.

Native helper smoke on Apple Silicon, 24-GiB unified memory, macOS 27.0.1, Metal, debug helper: both models returned the correct checklist owner/deadline and exact supporting quote. E2B cold/warm/multi-batch requests took 3.80/1.08/7.41 seconds; E4B took 5.85/2.08/19.11 seconds. This preliminary smoke used temperature 0.1; final application inference uses greedy decoding and has separate acceptance below. These are single-fixture observations, not a comparative accuracy/speed benchmark or a measured memory-reduction claim. A physical 8-GB Mac was unavailable; low-memory qualification remains a release limitation.

## Verification

Final checks on the November 14 implementation:

- 86 frontend tests passed (`bun test tests`); TypeScript and the production Next.js build passed.
- 128 native summary/chat tests passed, with the real-model test excluded from the default suite; two helper tests passed with Metal enabled.
- The opt-in native acceptance test passed separately for both models in 55.75 seconds total: SQLite retrieval beyond row 128, foreign-meeting isolation, exact source validation, safe unsupported-question handling, standard notes generation with an agreed unassigned task in its own table row, corrected final decision, cancellation and helper restart.
- The isolated `Meetily MVP Test.app` build passed. It is ad-hoc signed, not notarized or installed. The first bundle attempt completed the app but failed optional updater signing; the completed rerun disabled updater artifacts only in the temporary test configuration.
- Whole-diff self-review and `git diff --check` passed. Review caught relevance-tie chronology and E4B's omission of an unassigned action row; both were corrected and verified. Final controller review additionally found and fixed the Stop/new-draft continuation race and random-ID ordering of legacy rows without audio timestamps. PR review evidence is anchored to the final publication revision; no independent human approval is claimed.

 Source integration tests use in-memory SQLite and synthetic transcripts only. The opt-in native test additionally uses the real configured helper and locally staged model files, isolated from the user's app profile:

```sh
MEETILY_TEST_MODELS=/path/to/verified/gguf/directory \
MEETILY_LLAMA_HELPER=/path/to/metal/llama-helper \
cargo test --locked -p meetily --lib summary::ask_ai::tests::native_gemma_mvp_acceptance -- --ignored --nocapture
```

Final native functional UI acceptance passed using the actual isolated Tauri app, real SQLite, bundled helper and Gemma models. A temporary debug-only harness dispatched normal DOM events to rendered controls and captured state; it did not replace the native transport or model. It was removed from source before publication. Verified: selected-meeting answer and exact timestamped source expansion, A/B isolation, transcript navigation, summary generation including the unassigned ledger row, Stop preserving a new draft, model restart, reset/close during generation, close/reopen isolation, settings deep link and an explicitly saved E2B selection reflected in chat.

The standard computer-use service still fails with `unknown or expired node_repl continuation`. Direct accessibility/capture sees a background WebKit window (`document.visibilityState=hidden`, no animation-frame callbacks), so no screenshot/layout approval is claimed. Functional UI evidence is recorded separately from this rendering limitation. No installer, production installation, upstream submission or release is included.

## Final accuracy and memory checks

On the same 24-GiB Mac, six public synthetic chat fixtures per model covered owner/deadline extraction, corrected decisions, unassigned tasks, proposals versus commitments, Spanish evidence and a transcript instruction attack. All ten non-adversarial runs returned the expected facts with exact valid source quotations. E4B also ignored the injected instruction and cited the correct source. E2B answered the factual question but cited the wrong source number in that adversarial case; native validation rejects that response rather than exposing an unsupported answer. This is a small qualification set, not a general accuracy guarantee.

| Metric | E2B | E4B |
| --- | ---: | ---: |
| First request in a fresh helper process | 3.89 s | 7.38 s |
| Subsequent fixture completion range | 1.47–1.92 s | 2.90–3.80 s |
| Peak sampled process RSS | 3.50 GiB | 6.62 GiB |
| Kernel lifetime maximum process physical footprint | 0.68 GiB | 2.13 GiB |

Memory comes from `proc_pid_rusage` v4, sampled every 50 ms plus the kernel lifetime maximum. RSS includes mappings; physical footprint accounts for them differently. Neither metric establishes whole-system/GPU headroom on an 8-GB machine. There is no physical 8-GB result; the automatic low-memory Gemma default is therefore deferred, not treated as passing. The benchmark uses final greedy decoding and pinned model files. Raw outputs, driver and review annotations are in the task evidence directory.

Final affected verification: 87 frontend tests, 129 native summary tests, TypeScript, production frontend build, the separate real-model acceptance test and the isolated final macOS app build. Unchanged helper sampling checks retain their prior two-test pass. Review findings were remediated and no known blocking code findings remain.

Related work: upstream [#810](https://github.com/Zackriya-Solutions/meetily/pull/810), [#770](https://github.com/Zackriya-Solutions/meetily/pull/770), [#497](https://github.com/Zackriya-Solutions/meetily/pull/497), [#593](https://github.com/Zackriya-Solutions/meetily/pull/593) and [#548](https://github.com/Zackriya-Solutions/meetily/issues/548). #810 remains open and conflicting; #593 is closed and unmerged. This continues the existing user-owned fork PR, with #810 attribution preserved, rather than opening a competing upstream PR.
