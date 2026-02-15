-- Lens configuration table
-- Stores per-branch (or global default) lens parameters.

BEGIN;

CREATE TABLE charcoal.lens_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NULL REFERENCES charcoal.branches(id) ON DELETE CASCADE,
    recency_limit INT NOT NULL DEFAULT 20,
    max_tokens INT NOT NULL DEFAULT 4096,
    include_anchors BOOLEAN NOT NULL DEFAULT true,
    semantic_limit INT NOT NULL DEFAULT 5,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_lens_config_branch UNIQUE (branch_id)
);

-- Global default config (branch_id = NULL)
INSERT INTO charcoal.lens_config (branch_id, recency_limit, max_tokens, include_anchors, semantic_limit)
VALUES (NULL, 20, 4096, true, 5);

COMMIT;
