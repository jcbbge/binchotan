-- Scribe notification trigger
-- Sends NOTIFY on new message insert so the Scribe background worker can process it.

BEGIN;

CREATE OR REPLACE FUNCTION charcoal.notify_new_message()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('charcoal_new_message', NEW.id::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER messages_notify_insert
    AFTER INSERT ON charcoal.messages
    FOR EACH ROW EXECUTE FUNCTION charcoal.notify_new_message();

COMMIT;
