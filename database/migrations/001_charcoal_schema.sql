-- Charcoal schema migration
-- Creates tables for the Binchotan memory layer in the existing Anima database.
-- The `vector` extension is already enabled — do not recreate it.
-- Idempotent: safe to re-run.

BEGIN;

CREATE SCHEMA IF NOT EXISTS charcoal;

-- Branches

CREATE TABLE IF NOT EXISTS charcoal.branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    head_id UUID NULL,  -- FK added after messages table exists
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Messages

CREATE TABLE IF NOT EXISTS charcoal.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES charcoal.branches(id),
    parent_id UUID REFERENCES charcoal.messages(id) NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_anchor BOOLEAN NOT NULL DEFAULT false,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- Now add the deferred FK from branches.head_id -> messages.id
DO $$ BEGIN
    ALTER TABLE charcoal.branches
        ADD CONSTRAINT fk_branches_head_id
        FOREIGN KEY (head_id) REFERENCES charcoal.messages(id);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Embeddings (768 dimensions for nomic-embed-text)

CREATE TABLE IF NOT EXISTS charcoal.embeddings (
    message_id UUID PRIMARY KEY REFERENCES charcoal.messages(id),
    embedding vector(768) NOT NULL
);

-- Indexes

CREATE INDEX IF NOT EXISTS idx_messages_parent_id ON charcoal.messages(parent_id);
CREATE INDEX IF NOT EXISTS idx_messages_branch_created ON charcoal.messages(branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw ON charcoal.embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- updated_at trigger on branches

CREATE OR REPLACE FUNCTION charcoal.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
    CREATE TRIGGER branches_updated_at
        BEFORE UPDATE ON charcoal.branches
        FOR EACH ROW EXECUTE FUNCTION charcoal.update_updated_at();
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
