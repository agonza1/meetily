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

/// A bounded excerpt; IDs and timestamps always originate in SQLite.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub segment_id: String,
    pub timestamp: String,
    pub text: String,
}

pub struct MeetingContext {
    pub text: String,
    pub truncated: bool,
    pub included_segments: usize,
    pub sources: Vec<Source>,
    pub matches: Vec<Source>,
}

// Small local lexical lookup, with no new index, dependencies or changed source text.
fn terms(text: &str) -> Vec<String> {
    let mut result = Vec::new();
    for word in text
        .split(|c: char| !c.is_alphanumeric())
        .map(str::to_lowercase)
    {
        if word.chars().count() < 2
            || "the this that these those was were are what which who when where how why did does about with from have has had for and our can you please meeting tell give summarize summary topics discussed list all key made any its they them their will would could should there then more detail details"
                .split_whitespace().any(|stop| stop == word)
        {
            continue;
        }
        if !result.contains(&word) {
            result.push(word);
        }
    }
    result.truncate(32);
    result
}

struct Candidate {
    source: Source,
    score: usize,
    order: usize,
}

/// Streams every row through bounded overlapping windows, retaining only the best candidates.
/// This avoids a first-N-row cutoff and avoids retaining the entire transcript in RAM.
pub struct Retrieval {
    terms: Vec<String>,
    best: Vec<Candidate>,
    sampled: Vec<Candidate>,
    count: usize,
}

impl Retrieval {
    pub fn new(query: &str) -> Self {
        Self {
            terms: terms(query),
            best: Vec::new(),
            sampled: Vec::new(),
            count: 0,
        }
    }
    pub fn push(&mut self, id: &str, timestamp: &str, content: &str) {
        let mut remaining = content;
        while !remaining.is_empty() {
            let window = utf8_prefix(remaining, 1_200);
            let lower = window.to_lowercase();
            let words: Vec<_> = lower.split(|c: char| !c.is_alphanumeric()).collect();
            let score = self
                .terms
                .iter()
                .filter(|term| words.contains(&term.as_str()))
                .count();
            let source = Source {
                segment_id: id.to_string(),
                timestamp: timestamp.to_string(),
                text: window.to_string(),
            };
            self.best.push(Candidate {
                source: source.clone(),
                score,
                order: self.count,
            });
            self.best
                .sort_by(|a, b| b.score.cmp(&a.score).then(b.order.cmp(&a.order)));
            self.best.truncate(24);
            // A deterministic overview spanning the meeting, including its end. Keep bounded memory.
            self.sampled.push(Candidate {
                source,
                score: 0,
                order: self.count,
            });
            if self.sampled.len() > 24 {
                // Thin the densest adjacent pair, preserving the first and newest excerpts.
                let index = (1..self.sampled.len() - 1)
                    .min_by_key(|&i| self.sampled[i + 1].order - self.sampled[i - 1].order)
                    .unwrap();
                self.sampled.remove(index);
            }
            self.count += 1;
            if window.len() == remaining.len() {
                break;
            }
            // Overlap preserves phrases crossing a window boundary.
            let advance = utf8_prefix(window, 960).len();
            remaining = &remaining[advance..];
        }
    }
    pub fn finish(self, title: &str, created_at: &str) -> MeetingContext {
        let candidates = if self.best.first().is_some_and(|c| c.score > 0) {
            self.best
        } else {
            self.sampled.into_iter().rev().collect()
        };
        let mut text = format!(
            "Meeting: {}\nCreated: {}\nTranscript excerpts (JSON data):\n",
            utf8_prefix(title, 512),
            utf8_prefix(created_at, 128)
        );
        let mut selected = Vec::new();
        let mut budget = text.len();
        for candidate in candidates {
            // Budget JSON escaping and its header before retaining an excerpt. Two digits
            // overestimate the source field for the first nine entries.
            let bytes = serde_json::json!({"source": 24, "text": candidate.source.text})
                .to_string()
                .len()
                + 1;
            if budget + bytes > MAX_CONTEXT_BYTES - 160 {
                continue;
            }
            budget += bytes;
            selected.push(candidate);
        }
        // Preview only lexical matches, in relevance order. The sampled overview is not a match.
        let mut matches: Vec<Source> = Vec::new();
        for candidate in selected.iter().take_while(|candidate| candidate.score > 0) {
            if !matches.iter().any(|source| source.segment_id == candidate.source.segment_id) {
                matches.push(candidate.source.clone());
                if matches.len() == 2 {
                    break;
                }
            }
        }
        // Rank for selection, then restore transcript order so later corrections stay later.
        selected.sort_by_key(|candidate| candidate.order);
        let mut sources = Vec::new();
        for candidate in selected {
            let entry =
                serde_json::json!({"source": sources.len()+1, "text": candidate.source.text});
            text.push_str(&format!("{}\n", entry));
            sources.push(candidate.source);
        }
        let truncated = sources.len() < self.count;
        if truncated {
            text.push_str("[Only part of this meeting is included. Do not claim to have searched omitted content.]\n");
        }
        let included_segments = sources
            .iter()
            .map(|s| &s.segment_id)
            .collect::<std::collections::HashSet<_>>()
            .len();
        MeetingContext {
            text,
            truncated,
            included_segments,
            sources,
            matches,
        }
    }
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct ModelAnswer {
    answer: String,
    sources: Vec<ModelCitation>,
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct ModelCitation {
    source: usize,
    quote: String,
}

pub const UNSUPPORTED: &str = "I couldn't find enough evidence in the supplied transcript excerpts to answer that. Try a more specific question or check the transcript.";

/// Validate exact quotations and resolve IDs/timestamps on-device, never from generated metadata.
/// This validates provenance, not whether every generated claim follows from the quotation.
pub fn validate_answer(
    raw: &str,
    context: &MeetingContext,
) -> Result<(String, Vec<Source>), String> {
    let invalid =
        "The model could not provide valid transcript sources. Try a more specific question.";
    if raw.len() > 32_000 {
        return Err(invalid.into());
    }
    let raw = raw.trim();
    let raw = raw
        .strip_prefix("```json")
        .or_else(|| raw.strip_prefix("```"))
        .and_then(|s| s.trim().strip_suffix("```"))
        .unwrap_or(raw)
        .trim();
    let answer: ModelAnswer = serde_json::from_str(raw).map_err(|_| invalid.to_string())?;
    if answer.sources.is_empty() {
        return Ok((UNSUPPORTED.to_string(), Vec::new()));
    }
    if answer.answer.trim().is_empty() || answer.sources.len() > 8 {
        return Err(invalid.into());
    }
    let mut sources = Vec::new();
    for citation in answer.sources {
        let source = citation
            .source
            .checked_sub(1)
            .and_then(|i| context.sources.get(i))
            .ok_or(invalid)?;
        let quote = citation.quote.trim();
        if quote.is_empty() || quote.len() > 1_200 || !source.text.contains(quote) {
            return Err(invalid.into());
        }
        let resolved = Source {
            segment_id: source.segment_id.clone(),
            timestamp: source.timestamp.clone(),
            text: quote.to_string(),
        };
        if !sources
            .iter()
            .any(|s: &Source| s.segment_id == resolved.segment_id && s.text == resolved.text)
        {
            sources.push(resolved);
        }
    }
    Ok((answer.answer.trim().to_string(), sources))
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
    fn relevant_evidence_after_early_rows_and_inside_huge_row_is_found() {
        let mut r = Retrieval::new("Who owns the zebra rollout?");
        for i in 0..200 {
            r.push(
                &format!("s{i}"),
                "00:01",
                "Introductions and routine updates.",
            );
        }
        r.push(
            "late",
            "45:00",
            &format!(
                "{} Zebra rollout owner is Maya.",
                "irrelevant ".repeat(10_000)
            ),
        );
        let c = r.finish("Test", "2026");
        assert!(c.text.contains("Zebra rollout owner is Maya"));
        assert!(c.truncated);
        assert!(c.text.len() <= MAX_CONTEXT_BYTES);
        assert!(c
            .sources
            .iter()
            .any(|s| s.segment_id == "late" && s.timestamp == "45:00"));
    }
    #[test]
    fn unicode_overview_preserves_final_excerpt_and_stays_bounded() {
        let mut r = Retrieval::new("Give a summary of this meeting");
        for i in 0..200 {
            r.push(&format!("s{i}"), "01:00", &"患者🙂".repeat(400));
        }
        r.push("end", "59:00", "Final decision: keep the launch.");
        let c = r.finish("Test", "2026");
        assert!(c.text.len() <= MAX_CONTEXT_BYTES);
        assert!(c.truncated);
        // Overview selection reserves the newest excerpt before restoring transcript order.
        assert!(c.sources.iter().any(|s| s.segment_id == "end"));
    }
    #[test]
    fn equally_relevant_later_corrections_survive_the_budget_in_transcript_order() {
        let mut retrieval = Retrieval::new("budget");
        for i in 0..100 {
            retrieval.push(&format!("s{i}"), "00:00", "The budget is under discussion.");
        }
        retrieval.push(
            "correction",
            "59:00",
            "Final budget correction: the approved amount is 42.",
        );
        let context = retrieval.finish("Synthetic", "2026");
        assert_eq!(context.sources.last().unwrap().segment_id, "correction");
        assert!(context.text.contains("approved amount is 42"));
    }
    fn context() -> MeetingContext {
        let mut r = Retrieval::new("checklist");
        r.push("s1", "01:20", "Maya will send the checklist by Friday.");
        r.finish("Synthetic", "2026")
    }
    #[test]
    fn citations_resolve_database_metadata_and_exact_quotations() {
        let c = context();
        let (answer,sources) = validate_answer(r#"{"answer":"Maya, by Friday.","sources":[{"source":1,"quote":"Maya will send the checklist by Friday."}]}"#, &c).unwrap();
        assert_eq!(answer, "Maya, by Friday.");
        assert_eq!(sources[0].segment_id, "s1");
        assert_eq!(sources[0].timestamp, "01:20");
        assert!(!c.truncated);
    }
    #[test]
    fn fabricated_sources_quotes_and_unstructured_answers_are_rejected() {
        let c = context();
        for raw in [
            r#"{"answer":"x","sources":[{"source":2,"quote":"Maya"}]}"#,
            r#"{"answer":"x","sources":[{"source":1,"quote":"invented"}]}"#,
            "Uncited answer",
        ] {
            assert!(validate_answer(raw, &c).is_err());
        }
        assert_eq!(
            validate_answer(r#"{"answer":"invented","sources":[]}"#, &c)
                .unwrap()
                .0,
            UNSUPPORTED
        );
    }
}
