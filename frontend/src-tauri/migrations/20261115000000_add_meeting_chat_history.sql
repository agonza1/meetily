CREATE TABLE meeting_chat_conversations (
    meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

-- One row is one completed exchange; pending/failed assistant output is never stored.
CREATE TABLE meeting_chat_exchanges (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL UNIQUE,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    sources_json TEXT NOT NULL,
    context_truncated INTEGER NOT NULL CHECK (context_truncated IN (0, 1)),
    created_at TEXT NOT NULL
);
CREATE INDEX meeting_chat_exchange_scope ON meeting_chat_exchanges(meeting_id, sequence DESC);

-- A changed transcript invalidates both saved evidence and any generation in flight.
CREATE TRIGGER meeting_chat_transcript_insert AFTER INSERT ON transcripts BEGIN
    DELETE FROM meeting_chat_exchanges WHERE meeting_id = NEW.meeting_id;
    UPDATE meeting_chat_conversations SET revision = revision + 1 WHERE meeting_id = NEW.meeting_id;
END;
CREATE TRIGGER meeting_chat_transcript_delete AFTER DELETE ON transcripts BEGIN
    DELETE FROM meeting_chat_exchanges WHERE meeting_id = OLD.meeting_id;
    UPDATE meeting_chat_conversations SET revision = revision + 1 WHERE meeting_id = OLD.meeting_id;
END;
CREATE TRIGGER meeting_chat_transcript_update
AFTER UPDATE OF id, meeting_id, transcript, timestamp, audio_start_time ON transcripts
WHEN OLD.id IS NOT NEW.id OR OLD.meeting_id IS NOT NEW.meeting_id
  OR OLD.transcript IS NOT NEW.transcript OR OLD.timestamp IS NOT NEW.timestamp
  OR OLD.audio_start_time IS NOT NEW.audio_start_time
BEGIN
    DELETE FROM meeting_chat_exchanges WHERE meeting_id IN (OLD.meeting_id, NEW.meeting_id);
    UPDATE meeting_chat_conversations SET revision = revision + 1
        WHERE meeting_id IN (OLD.meeting_id, NEW.meeting_id);
END;
