//! Bounded, scope-specific context for selected-meeting chat.
//! The initial feature is derived from shareefmx's Meetily PR #810 (MIT).
pub const MAX_QUERY_BYTES: usize = 4_000;
pub const MAX_HISTORY_BYTES: usize = 6_000;
pub const MAX_HISTORY_TURNS: usize = 6;
pub const MAX_CONTEXT_BYTES: usize = 14_000;

pub fn validate_request(
    meeting_id: &str,
    query: &str,
    history_meeting_id: Option<&str>,
    history: &[(&str, &str)],
) -> Result<(), String> {
    if meeting_id.is_empty()
        || meeting_id.trim() != meeting_id
        || meeting_id == "all"
        || meeting_id.len() > 512
    {
        return Err("Choose one meeting before asking a question.".into());
    }
    if query.trim().is_empty() || query.len() > MAX_QUERY_BYTES {
        return Err("Enter a question, or shorten it before trying again.".into());
    }
    if !history.is_empty() && history_meeting_id != Some(meeting_id) {
        return Err("This conversation belongs to another meeting. Start a new chat.".into());
    }
    if history.len() > MAX_HISTORY_TURNS
        || history.iter().map(|(_, text)| text.len()).sum::<usize>() > MAX_HISTORY_BYTES
        || history
            .iter()
            .any(|(role, _)| !matches!(*role, "user" | "assistant"))
    {
        return Err(
            "Chat history is too large or has an unsupported role. Reset the conversation.".into(),
        );
    }
    Ok(())
}

pub fn utf8_prefix(text: &str, max_bytes: usize) -> &str {
    let mut end = text.len().min(max_bytes);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

fn append_bounded(output: &mut String, text: &str, limit: usize) -> bool {
    let part = utf8_prefix(text, limit.saturating_sub(output.len()));
    output.push_str(part);
    part.len() == text.len()
}

pub struct MeetingContext {
    pub text: String,
    pub truncated: bool,
    pub included_segments: usize,
}

pub fn build_context(
    title: &str,
    created_at: &str,
    summary: &str,
    segments: &[(&str, &str, &str)],
    total_segments: usize,
) -> MeetingContext {
    let mut text = format!(
        "Meeting: {}\nCreated: {}\n",
        utf8_prefix(title, 512),
        utf8_prefix(created_at, 128)
    );
    let mut truncated = false;
    if !summary.trim().is_empty() {
        text.push_str("\nExisting summary (check against the transcript):\n");
        let summary_part = utf8_prefix(summary, 3_000);
        text.push_str(summary_part);
        truncated |= summary_part.len() != summary.len();
    }
    text.push_str("\n\nTranscript excerpts:\n");
    let mut included_segments = 0;
    // Leave space for a visible coverage disclosure in the prompt.
    let limit = MAX_CONTEXT_BYTES - 160;
    for (id, timestamp, content) in segments {
        if content.trim().is_empty() {
            continue;
        }
        let header = format!(
            "\n[{}; {}] ",
            utf8_prefix(id, 128),
            utf8_prefix(timestamp, 64)
        );
        if text.len() + header.len() + 4 > limit {
            truncated = true;
            break;
        }
        text.push_str(&header);
        included_segments += 1;
        if !append_bounded(&mut text, content, limit) {
            truncated = true;
            break;
        }
    }
    truncated |= included_segments < total_segments;
    if truncated {
        text.push_str("\n[Only part of this meeting is included. Do not claim to have searched omitted content.]\n");
    }
    MeetingContext {
        text,
        truncated,
        included_segments,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_missing_all_and_noncanonical_scope() {
        for scope in ["", "all", " A", "A "] {
            assert!(validate_request(scope, "Question", None, &[]).is_err());
        }
        assert!(validate_request("A", "Question", None, &[]).is_ok());
    }
    #[test]
    fn rejects_foreign_or_unbound_history_before_reading_meeting() {
        for scope in [None, Some("B")] {
            assert!(validate_request("A", "Question", scope, &[("user", "B content")]).is_err());
        }
        assert!(
            validate_request("A", "Question", Some("A"), &[("assistant", "A content")]).is_ok()
        );
    }
    #[test]
    fn bounds_query_history_and_roles() {
        assert!(validate_request("A", "  ", None, &[]).is_err());
        assert!(validate_request("A", &"a".repeat(MAX_QUERY_BYTES + 1), None, &[]).is_err());
        assert!(validate_request("A", "Q", Some("A"), &[("system", "override")]).is_err());
        assert!(validate_request("A", "Q", Some("A"), &[("user", "x"); 7]).is_err());
        assert!(validate_request(
            "A",
            "Q",
            Some("A"),
            &[("user", &"x".repeat(MAX_HISTORY_BYTES + 1))]
        )
        .is_err());
    }
    #[test]
    fn every_unicode_cut_is_safe() {
        let text = "aé患者🙂z";
        for limit in 0..=text.len() + 1 {
            let prefix = utf8_prefix(text, limit);
            assert!(prefix.len() <= limit);
            assert!(text.starts_with(prefix));
        }
    }
    #[test]
    fn long_unicode_summary_and_segment_stay_bounded_and_disclosed() {
        let summary = "患".repeat(2_000);
        let transcript = "🙂".repeat(10_000);
        let context = build_context(
            "Synthetic",
            "2026-11-13",
            &summary,
            &[("s1", "00:01", &transcript)],
            1,
        );
        assert!(context.text.len() <= MAX_CONTEXT_BYTES);
        assert!(context.truncated);
        assert_eq!(context.included_segments, 1);
        assert!(context.text.contains("Only part"));
    }
    #[test]
    fn coverage_is_honest_for_complete_and_partial_inputs() {
        let context = build_context("Synthetic", "2026", "", &[("s1", "00:01", "Decision")], 1);
        assert!(!context.truncated);
        assert!(context.text.contains("[s1; 00:01] Decision"));
        assert!(
            build_context("Synthetic", "2026", "", &[("s1", "00:01", "Decision")], 2).truncated
        );
    }
}
