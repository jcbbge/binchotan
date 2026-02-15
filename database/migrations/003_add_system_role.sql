-- Allow 'system' role for merge messages and other system-generated content.

BEGIN;

ALTER TABLE charcoal.messages
    DROP CONSTRAINT messages_role_check;

ALTER TABLE charcoal.messages
    ADD CONSTRAINT messages_role_check
    CHECK (role IN ('user', 'assistant', 'system'));

COMMIT;
