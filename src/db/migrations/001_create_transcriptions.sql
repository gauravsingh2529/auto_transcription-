CREATE TABLE IF NOT EXISTS transcriptions (
  id           BIGSERIAL PRIMARY KEY,
  title        VARCHAR(200) NOT NULL,
  text         TEXT         NOT NULL CHECK (char_length(text) > 0),
  language     VARCHAR(64),
  source       VARCHAR(20)  NOT NULL DEFAULT 'manual'
               CHECK (source IN ('gemini-live', 'web-speech', 'manual')),
  duration_ms  INTEGER      CHECK (duration_ms >= 0),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Dashboard lists newest first and pages through history.
CREATE INDEX IF NOT EXISTS idx_transcriptions_created_at ON transcriptions (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_transcriptions_source     ON transcriptions (source);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transcriptions_updated_at ON transcriptions;
CREATE TRIGGER trg_transcriptions_updated_at
  BEFORE UPDATE ON transcriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
