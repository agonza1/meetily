//! Local, bounded history of completed selected-meeting exchanges.
use sqlx::{Sqlite, SqlitePool, Transaction};
use tokio_util::sync::CancellationToken;

pub const MAX_EXCHANGES: i64 = 20;

#[derive(Debug, thiserror::Error)]
pub enum HistoryError {
    #[error("database operation failed")]
    Database(#[from] sqlx::Error),
    #[error("meeting is unavailable")]
    Missing,
    #[error("conversation changed")]
    Changed,
    #[error("request was cancelled")]
    Cancelled,
}

#[derive(sqlx::FromRow)]
pub struct Exchange {
    pub request_id: String,
    pub question: String,
    pub answer: String,
    pub provider: String,
    pub model: String,
    pub sources_json: String,
    pub context_truncated: bool,
    pub created_at: String,
}

pub struct Conversation {
    pub revision: i64,
    pub exchanges: Vec<Exchange>,
}

pub struct NewExchange<'a> {
    pub request_id: &'a str,
    pub question: &'a str,
    pub answer: &'a str,
    pub provider: &'a str,
    pub model: &'a str,
    pub sources_json: &'a str,
    pub context_truncated: bool,
}

async fn ensure(tx: &mut Transaction<'_, Sqlite>, meeting_id: &str) -> Result<i64, HistoryError> {
    sqlx::query("INSERT INTO meeting_chat_conversations (meeting_id) SELECT id FROM meetings WHERE id = ? ON CONFLICT(meeting_id) DO NOTHING")
        .bind(meeting_id).execute(&mut **tx).await?;
    sqlx::query_scalar("SELECT revision FROM meeting_chat_conversations WHERE meeting_id = ?")
        .bind(meeting_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(HistoryError::Missing)
}

pub async fn load(pool: &SqlitePool, meeting_id: &str) -> Result<Conversation, HistoryError> {
    let mut tx = pool.begin().await?;
    let revision = ensure(&mut tx, meeting_id).await?;
    let mut exchanges = sqlx::query_as::<_, Exchange>("SELECT request_id, question, answer, provider, model, sources_json, context_truncated, created_at FROM meeting_chat_exchanges WHERE meeting_id = ? ORDER BY sequence DESC LIMIT ?")
        .bind(meeting_id).bind(MAX_EXCHANGES).fetch_all(&mut *tx).await?;
    exchanges.reverse();
    tx.commit().await?;
    Ok(Conversation {
        revision,
        exchanges,
    })
}

pub async fn clear(pool: &SqlitePool, meeting_id: &str) -> Result<i64, HistoryError> {
    let mut tx = pool.begin().await?;
    ensure(&mut tx, meeting_id).await?;
    let revision = sqlx::query_scalar("UPDATE meeting_chat_conversations SET revision = revision + 1 WHERE meeting_id = ? RETURNING revision")
        .bind(meeting_id).fetch_one(&mut *tx).await?;
    sqlx::query("DELETE FROM meeting_chat_exchanges WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(revision)
}

pub async fn append(
    pool: &SqlitePool,
    meeting_id: &str,
    expected_revision: i64,
    exchange: NewExchange<'_>,
    cancellation: &CancellationToken,
) -> Result<(i64, String), HistoryError> {
    if cancellation.is_cancelled() {
        return Err(HistoryError::Cancelled);
    }
    let mut tx = pool.begin().await?;
    // Compare-and-swap makes clear, transcript invalidation and concurrent replies linearizable.
    let revision: i64 = sqlx::query_scalar("UPDATE meeting_chat_conversations SET revision = revision + 1 WHERE meeting_id = ? AND revision = ? RETURNING revision")
        .bind(meeting_id).bind(expected_revision).fetch_optional(&mut *tx).await?.ok_or(HistoryError::Changed)?;
    let created_at = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO meeting_chat_exchanges (request_id, meeting_id, question, answer, provider, model, sources_json, context_truncated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(exchange.request_id).bind(meeting_id).bind(exchange.question).bind(exchange.answer)
        .bind(exchange.provider).bind(exchange.model).bind(exchange.sources_json)
        .bind(exchange.context_truncated).bind(&created_at).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM meeting_chat_exchanges WHERE meeting_id = ? AND sequence NOT IN (SELECT sequence FROM meeting_chat_exchanges WHERE meeting_id = ? ORDER BY sequence DESC LIMIT ?)")
        .bind(meeting_id).bind(meeting_id).bind(MAX_EXCHANGES).execute(&mut *tx).await?;
    if cancellation.is_cancelled() {
        return Err(HistoryError::Cancelled);
    }
    tx.commit().await?;
    Ok((revision, created_at))
}

#[cfg(test)]
mod tests {
    use super::*;
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
        }
        pool
    }
    async fn save(
        pool: &SqlitePool,
        meeting: &str,
        revision: i64,
        id: &str,
        token: &CancellationToken,
    ) -> Result<(i64, String), HistoryError> {
        append(
            pool,
            meeting,
            revision,
            NewExchange {
                request_id: id,
                question: "Who owns it?",
                answer: "Maya owns it.",
                provider: "builtin-ai",
                model: "synthetic",
                sources_json: r#"[{"segmentId":"s1","timestamp":"00:01","text":"Maya owns it."}]"#,
                context_truncated: true,
            },
            token,
        )
        .await
    }
    #[tokio::test]
    async fn restores_scoped_exchanges_and_source_metadata() {
        let pool = database().await;
        let token = CancellationToken::new();
        load(&pool, "A").await.unwrap();
        save(&pool, "A", 0, "a1", &token).await.unwrap();
        let a = load(&pool, "A").await.unwrap();
        assert_eq!(a.revision, 1);
        assert_eq!(a.exchanges.len(), 1);
        assert_eq!(a.exchanges[0].question, "Who owns it?");
        assert!(a.exchanges[0].sources_json.contains("s1"));
        assert!(a.exchanges[0].context_truncated);
        assert!(load(&pool, "B").await.unwrap().exchanges.is_empty());
        assert!(load(&pool, "A' OR 1=1 --").await.is_err());
    }
    #[tokio::test]
    async fn file_backed_history_survives_pool_close_and_restart() {
        let path =
            std::env::temp_dir().join(format!("meetily-history-{}.sqlite", uuid::Uuid::new_v4()));
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true);
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options.clone())
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        sqlx::query("INSERT INTO meetings(id,title,created_at,updated_at) VALUES('A','Legacy synthetic notes','2026','2026')").execute(&pool).await.unwrap();
        load(&pool, "A").await.unwrap();
        save(
            &pool,
            "A",
            0,
            "saved-before-restart",
            &CancellationToken::new(),
        )
        .await
        .unwrap();
        pool.close().await;
        let reopened = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&reopened).await.unwrap();
        let saved = load(&reopened, "A").await.unwrap();
        assert_eq!(saved.revision, 1);
        assert_eq!(saved.exchanges[0].request_id, "saved-before-restart");
        assert!(saved.exchanges[0].sources_json.contains("00:01"));
        let title: String = sqlx::query_scalar("SELECT title FROM meetings WHERE id='A'")
            .fetch_one(&reopened)
            .await
            .unwrap();
        assert_eq!(title, "Legacy synthetic notes");
        reopened.close().await;
        std::fs::remove_file(path).unwrap();
    }
    #[tokio::test]
    async fn upgrade_preserves_legacy_notes_transcripts_and_model_settings() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let mut previous = sqlx::migrate!("./migrations");
        previous.migrations = std::borrow::Cow::Owned(
            previous
                .iter()
                .filter(|m| m.version < 20261115000000)
                .cloned()
                .collect(),
        );
        previous.run(&pool).await.unwrap();
        sqlx::query("INSERT INTO meetings(id,title,created_at,updated_at) VALUES('A','Legacy meeting','2026','2026')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO transcripts(id,meeting_id,transcript,timestamp) VALUES('legacy','A','Original transcript','00:01')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO meeting_notes(meeting_id,notes_markdown,created_at,updated_at) VALUES('A','User-edited notes','2026','2026')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO settings(id,provider,model,whisperModel) VALUES('1','builtin-ai','gemma4:e2b','large-v3')").execute(&pool).await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let text: String =
            sqlx::query_scalar("SELECT transcript FROM transcripts WHERE id='legacy'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(text, "Original transcript");
        let notes: String =
            sqlx::query_scalar("SELECT notes_markdown FROM meeting_notes WHERE meeting_id='A'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(notes, "User-edited notes");
        let model: String = sqlx::query_scalar("SELECT model FROM settings WHERE id='1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(model, "gemma4:e2b");
        assert!(load(&pool, "A").await.unwrap().exchanges.is_empty());
    }
    #[tokio::test]
    async fn concurrent_completions_with_one_revision_cannot_both_commit() {
        let pool = database().await;
        load(&pool, "A").await.unwrap();
        let token = CancellationToken::new();
        let (first, second) = tokio::join!(
            save(&pool, "A", 0, "first", &token),
            save(&pool, "A", 0, "second", &token)
        );
        assert_eq!(usize::from(first.is_ok()) + usize::from(second.is_ok()), 1);
        assert_eq!(load(&pool, "A").await.unwrap().exchanges.len(), 1);
    }
    #[tokio::test]
    async fn clear_invalidates_late_save_without_erasing_other_meeting() {
        let pool = database().await;
        let token = CancellationToken::new();
        load(&pool, "A").await.unwrap();
        load(&pool, "B").await.unwrap();
        save(&pool, "A", 0, "a1", &token).await.unwrap();
        save(&pool, "B", 0, "b1", &token).await.unwrap();
        assert_eq!(clear(&pool, "A").await.unwrap(), 2);
        assert!(matches!(
            save(&pool, "A", 1, "late", &token).await,
            Err(HistoryError::Changed)
        ));
        assert!(load(&pool, "A").await.unwrap().exchanges.is_empty());
        assert_eq!(load(&pool, "B").await.unwrap().exchanges.len(), 1);
    }
    #[tokio::test]
    async fn cancelled_duplicate_and_stale_exchanges_cannot_partially_commit() {
        let pool = database().await;
        let token = CancellationToken::new();
        load(&pool, "A").await.unwrap();
        token.cancel();
        assert!(matches!(
            save(&pool, "A", 0, "cancelled", &token).await,
            Err(HistoryError::Cancelled)
        ));
        assert!(load(&pool, "A").await.unwrap().exchanges.is_empty());
        let token = CancellationToken::new();
        save(&pool, "A", 0, "first", &token).await.unwrap();
        assert!(save(&pool, "A", 1, "first", &token).await.is_err());
        assert_eq!(load(&pool, "A").await.unwrap().revision, 1);
        assert!(matches!(
            save(&pool, "A", 0, "stale", &token).await,
            Err(HistoryError::Changed)
        ));
    }
    #[tokio::test]
    async fn retention_keeps_latest_twenty_complete_pairs() {
        let pool = database().await;
        let token = CancellationToken::new();
        load(&pool, "A").await.unwrap();
        for n in 0..25 {
            save(&pool, "A", n, &format!("a{n}"), &token).await.unwrap();
        }
        let a = load(&pool, "A").await.unwrap();
        assert_eq!(a.exchanges.len(), 20);
        assert_eq!(a.exchanges[0].request_id, "a5");
        assert_eq!(a.exchanges[19].request_id, "a24");
    }
    #[tokio::test]
    async fn changed_transcript_invalidates_saved_and_inflight_evidence() {
        let pool = database().await;
        let token = CancellationToken::new();
        sqlx::query("INSERT INTO transcripts(id,meeting_id,transcript,timestamp) VALUES('s1','A','Maya owns it.','00:01')").execute(&pool).await.unwrap();
        load(&pool, "A").await.unwrap();
        save(&pool, "A", 0, "a1", &token).await.unwrap();
        sqlx::query("UPDATE transcripts SET transcript='Evan owns it.' WHERE id='s1'")
            .execute(&pool)
            .await
            .unwrap();
        let a = load(&pool, "A").await.unwrap();
        assert_eq!(a.revision, 2);
        assert!(a.exchanges.is_empty());
        assert!(matches!(
            save(&pool, "A", 1, "late", &token).await,
            Err(HistoryError::Changed)
        ));
        save(&pool, "A", 2, "new", &token).await.unwrap();
        sqlx::query("DELETE FROM transcripts WHERE id='s1'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(load(&pool, "A").await.unwrap().exchanges.is_empty());
    }
    #[tokio::test]
    async fn deleting_a_meeting_cascades_history_and_cannot_resurrect_it() {
        let pool = database().await;
        let token = CancellationToken::new();
        load(&pool, "A").await.unwrap();
        save(&pool, "A", 0, "a1", &token).await.unwrap();
        sqlx::query("DELETE FROM meetings WHERE id='A'")
            .execute(&pool)
            .await
            .unwrap();
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM meeting_chat_exchanges WHERE meeting_id='A'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 0);
        assert!(load(&pool, "A").await.is_err());
        assert!(save(&pool, "A", 1, "late", &token).await.is_err());
    }
}
