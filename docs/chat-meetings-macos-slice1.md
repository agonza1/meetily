# Selected-meeting chat: macOS slice 1

Select **Ask a meeting** in the sidebar, choose a meeting, and ask a question. Meeting details also exposes **Ask meeting**. The dialog reuses the actual AskMeetingsModal presentation from upstream #810: chat bubbles, quick prompts, answer copy, timestamps, loading state and the model/settings footer. It uses transcript excerpts from the selected meeting only. **Open transcript** lets the user check the original text. The model/provider come from the saved Summary settings; chat does not choose a new default or change those settings.

Built-in AI runs on-device. Other configured provider endpoints require explicit confirmation for each question. Credentials stay in the native configuration layer. A configuration version check blocks requests if the destination or model changed after the dialog loaded.

## Scope and limitations

- This slice has no all-meetings mode. It reads at most 128 ordered transcript rows and builds a maximum 14,000-byte UTF-8-safe context; omitted content is disclosed. It does not implement question-relevant retrieval over long meetings.
- Conversation history is transient, limited to six recent messages and 6,000 bytes. Questions are bounded to 4,000 bytes. Switching meetings or closing clears history. Model-generated answers remain unverified and can be wrong.
- Replies and pending submit continuations are bound to a conversation epoch. A reset, close, unmount, or meeting change cannot insert the old response or erase a new draft. These actions discard output; they do not yet stop the underlying model computation.
- No new question/transcript logging is introduced. Response Markdown cannot embed remote images or active links. This is a bounded feature claim, not a security audit of all upstream logging or providers.
- API-key changes remain native; only provider/model and a non-secret settings version are displayed. Chat does not persist answers or modify notes.

## Attribution

Adapted from [Muhammed Shareef M / shareefmx, PR #810](https://github.com/Zackriya-Solutions/meetily/pull/810), head b86d08999efbd6ee6e8257f764f9a837fc6de7de, under the repository's MIT license. The AskMeetingsModal.tsx presentation is imported from that pinned source and connected to this fork's tested hook/native implementation. The earlier minimal replacement view has been removed. The UI keeps the original styling and controls, adds Radix focus/escape handling, and retains transcript navigation, provider confirmation and safe Markdown. The duration shortcut is replaced by a topic question because this bounded context does not supply duration metadata. This is a focused adaptation, not a cherry-pick of all 14 files: cross-meeting sampling and the original history/model handling are deliberately excluded. No upstream contribution or contributor messaging is included in this delivery.

## Verification

On Apple Silicon macOS, Rust 1.99.1 and Bun 1.3.14:

- `bun test tests` from frontend: 83 passed, 0 failed, including 18 chat tests and the existing 65-test baseline.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: passed after the initial UI import; the final production Next build also type-checked the final UI changes.
- `NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next build`: passed on the final application code, 12 static pages.
- Native Rust checks below were run at f5c23d89088732ea630b93df3739571b0597bebb. This UI-reuse revision changes no native source, so those results remain applicable with that original revision.
- `cargo build --locked -p llama-helper`: passed.
- `cargo test --locked -p meetily --lib summary::chat_context::tests`: 6 passed.
- `cargo test --locked -p meetily --lib summary::ask_ai::tests`: 5 passed, using real in-memory SQLite migrations and synthetic meetings.
- Direct local helper inference using the supported Qwen 3.5 2B Q4_K_M model: passed a synthetic checklist question in 8.65 seconds including initial model load; answered that Maya would send it by Friday. This is helper/model proof, not app-to-model UI proof.
- Tauri debug app bundle build: passed under a separate test identifier. Existing upstream compiler warnings and stale Browserslist-data warning remain.

Native computer automation failed with an expired continuation while binding the isolated app. The UI and real app-to-model path have not been observed end-to-end; this remains an acceptance gate. No installer, release, or clinical-readiness claim is made. The draft PR preserves this limitation rather than treating mocked frontend tests as native UI proof.
