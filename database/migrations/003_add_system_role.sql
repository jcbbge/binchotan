-- Allow 'system' role for merge messages and other system-generated content.
-- Idempotent: safe to re-run.

BEGIN;

DO $$ BEGIN
    -- Only replace the constraint if 'system' is not already allowed
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name = 'messages_role_check'
          AND check_clause LIKE '%system%'
    ) THEN
        ALTER TABLE charcoal.messages DROP CONSTRAINT messages_role_check;
        ALTER TABLE charcoal.messages
            ADD CONSTRAINT messages_role_check
            CHECK (role IN ('user', 'assistant', 'system'));
    END IF;
END $$;

COMMIT;
