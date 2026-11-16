use crate::api::{TranscriptSearchResult, TranscriptSegment};
use chrono::Utc;
use sqlx::{Connection, Error as SqlxError, SqlitePool};
use log::{error, info};
use uuid::Uuid;

pub struct TranscriptsRepository;

impl TranscriptsRepository {
    /// Saves a new meeting and its associated transcript segments.
    /// This function uses a transaction to ensure that either both the meeting
    /// and all its transcripts are saved, or none of them are.
    pub async fn save_transcript(
        pool: &SqlitePool,
        meeting_title: &str,
        transcripts: &[TranscriptSegment],
        folder_path: Option<String>,
    ) -> Result<String, SqlxError> {
        let meeting_id = format!("meeting-{}", Uuid::new_v4());

        let mut conn = pool.acquire().await?;
        let mut transaction = conn.begin().await?;

        let now = Utc::now();

        // 1. Create the new meeting
        let result = sqlx::query(
            "INSERT INTO meetings (id, title, created_at, updated_at, folder_path) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&meeting_id)
        .bind(meeting_title)
        .bind(now)
        .bind(now)
        .bind(&folder_path)
        .execute(&mut *transaction)
        .await;

        if let Err(e) = result {
            error!("Failed to create meeting with id: {}", meeting_id);
            transaction.rollback().await?;
            return Err(e);
        }

        info!("Successfully created meeting with id: {}", meeting_id);

        // 2. Save each transcript segment with audio timing fields
        for segment in transcripts {
            let transcript_id = format!("transcript-{}", Uuid::new_v4());
            let result = sqlx::query(
                "INSERT INTO transcripts (id, meeting_id, transcript, timestamp, audio_start_time, audio_end_time, duration)
                 VALUES (?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&transcript_id)
            .bind(&meeting_id)
            .bind(&segment.text)
            .bind(&segment.timestamp)
            .bind(segment.audio_start_time)
            .bind(segment.audio_end_time)
            .bind(segment.duration)
            .execute(&mut *transaction)
            .await;

            if let Err(e) = result {
                error!("Failed to save transcript segment for meeting {}", meeting_id);
                transaction.rollback().await?;
                return Err(e);
            }
        }

        info!(
            "Successfully saved {} transcript segments for meeting {}",
            transcripts.len(),
            meeting_id
        );

        // Commit the transaction
        transaction.commit().await?;

        Ok(meeting_id)
    }

    /// Change one passage without altering its timing. Compare the original text to avoid lost edits.
    pub async fn update_text(
        pool: &SqlitePool,
        meeting_id: &str,
        transcript_id: &str,
        original: &str,
        text: &str,
    ) -> Result<bool, SqlxError> {
        let mut tx = pool.begin().await?;
        let changed = sqlx::query(
            "UPDATE transcripts SET transcript = ? WHERE id = ? AND meeting_id = ? AND transcript = ?",
        )
        .bind(text)
        .bind(transcript_id)
        .bind(meeting_id)
        .bind(original)
        .execute(&mut *tx)
        .await?
        .rows_affected()
            == 1;
        if changed {
            sqlx::query("UPDATE meetings SET updated_at = ? WHERE id = ?")
                .bind(Utc::now())
                .bind(meeting_id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(changed)
    }

    /// Searches for a query string within the transcripts.
    /// It returns a list of matching transcripts with context.
    pub async fn search_transcripts(
        pool: &SqlitePool,
        query: &str,
    ) -> Result<Vec<TranscriptSearchResult>, SqlxError> {
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }

        let search_query = format!("%{}%", query.to_lowercase());

        let rows = sqlx::query_as::<_, (String, String, String, String)>(
            "SELECT m.id, m.title, t.transcript, t.timestamp
             FROM meetings m
             JOIN transcripts t ON m.id = t.meeting_id
             WHERE LOWER(t.transcript) LIKE ?",
        )
        .bind(&search_query)
        .fetch_all(pool)
        .await?;

        let results = rows
            .into_iter()
            .map(|(id, title, transcript, timestamp)| {
                let match_context = Self::get_match_context(&transcript, query);
                TranscriptSearchResult {
                    id,
                    title,
                    match_context,
                    timestamp,
                }
            })
            .collect();

        Ok(results)
    }

    /// Helper function to extract a snippet of text around the first match of a query.
    fn get_match_context(transcript: &str, query: &str) -> String {
        let transcript_lower = transcript.to_lowercase();
        let query_lower = query.to_lowercase();

        match transcript_lower.find(&query_lower) {
            Some(match_index) => {
                let start_index = match_index.saturating_sub(100);
                let end_index = (match_index + query.len() + 100).min(transcript.len());

                let mut context = String::new();
                if start_index > 0 {
                    context.push_str("...");
                }
                context.push_str(&transcript[start_index..end_index]);
                if end_index < transcript.len() {
                    context.push_str("...");
                }
                context
            }
            None => transcript.chars().take(200).collect(), // Fallback to the start of the transcript
        }
    }
}

#[cfg(test)]
mod edit_tests {
    use super::*;
    use crate::database::repositories::meeting_chat;
    use tokio_util::sync::CancellationToken;

    async fn database() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        for id in ["A", "B"] {
            sqlx::query(
                "INSERT INTO meetings(id,title,created_at,updated_at) VALUES(?,?,'2026','2026')",
            )
            .bind(id)
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query("INSERT INTO transcripts(id,meeting_id,transcript,timestamp,audio_start_time,audio_end_time,duration,speaker) VALUES(?,?,'Monday','01:10',70,75,5,'Maya')").bind(id).bind(id).execute(&pool).await.unwrap();
        }
        pool
    }

    #[tokio::test]
    async fn correction_preserves_timing_and_invalidates_only_its_own_chat() {
        let pool = database().await;
        let token = CancellationToken::new();
        for id in ["A", "B"] {
            meeting_chat::load(&pool, id).await.unwrap();
            meeting_chat::append(
                &pool,
                id,
                0,
                meeting_chat::NewExchange {
                    request_id: id,
                    question: "When?",
                    answer: "Monday",
                    provider: "builtin-ai",
                    model: "synthetic",
                    sources_json: "[]",
                    context_truncated: false,
                },
                &token,
            )
            .await
            .unwrap();
        }
        assert!(
            TranscriptsRepository::update_text(&pool, "A", "A", "Monday", "Friday")
                .await
                .unwrap()
        );
        let passage: (String,String,f64,f64,f64,String) = sqlx::query_as("SELECT transcript,timestamp,audio_start_time,audio_end_time,duration,speaker FROM transcripts WHERE id='A'").fetch_one(&pool).await.unwrap();
        assert_eq!(
            passage,
            (
                "Friday".into(),
                "01:10".into(),
                70.0,
                75.0,
                5.0,
                "Maya".into()
            )
        );
        let a = meeting_chat::load(&pool, "A").await.unwrap();
        assert_eq!(a.revision, 2);
        assert!(a.exchanges.is_empty());
        assert_eq!(
            meeting_chat::load(&pool, "B")
                .await
                .unwrap()
                .exchanges
                .len(),
            1
        );
        assert!(
            !TranscriptsRepository::update_text(&pool, "A", "A", "Monday", "Stale overwrite")
                .await
                .unwrap()
        );
        assert!(
            !TranscriptsRepository::update_text(&pool, "B", "A", "Friday", "Wrong meeting")
                .await
                .unwrap()
        );
        assert_eq!(meeting_chat::load(&pool, "A").await.unwrap().revision, 2);
    }

    #[tokio::test]
    async fn concurrent_edits_do_not_overwrite_a_newer_correction() {
        let pool = database().await;
        let (first, second) = tokio::join!(
            TranscriptsRepository::update_text(&pool, "A", "A", "Monday", "Friday"),
            TranscriptsRepository::update_text(&pool, "A", "A", "Monday", "Tuesday")
        );
        assert_ne!(first.unwrap(), second.unwrap());
        let unchanged: String =
            sqlx::query_scalar("SELECT transcript FROM transcripts WHERE id='B'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(unchanged, "Monday");
    }
}
