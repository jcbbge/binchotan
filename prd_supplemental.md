We hear you. The system must be invisible, a silent layer that works behind the scenes. No slash commands, no extra overhead for the user or the AI—just natural conversation, with memory, branching, and merging handled automatically or through UI gestures.

Below is a specification for a **memory service** (codenamed **Charcoal**) that integrates with your existing Anima Docker stack (Postgres + pgvector, Ollama for embeddings and possibly light LLM tasks). It acts as a middleware between the chat frontend and the LLM, enriching the context and managing the immutable log without exposing its internals.

---

# Charcoal – Invisible Memory Layer

## 1. Overview

Charcoal sits between the chat UI and the LLM. Its job is to:

- Store every message in an immutable log (the diamond).
- Maintain a graph of messages with relations (branching, merging, tags, anchors).
- On each turn, dynamically assemble a relevant context (the lens) from the log.
- Provide endpoints for the UI to manage branches/merges (e.g., via buttons, not chat commands).
- Run background tasks (the **Scribe**) to compute embeddings, suggest tags, and detect topic shifts.

The user and the LLM never see Charcoal’s machinery; they only experience a conversation that remembers everything and can seamlessly switch contexts.

## 2. Data Model (PostgreSQL + pgvector)

All state is kept in PostgreSQL. The schema is an evolution of the SQLite version, optimized for production use.

### Tables

```sql
CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    head_id UUID REFERENCES messages(id) NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    parent_id UUID REFERENCES messages(id) NULL,
    role TEXT CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    is_anchor BOOLEAN DEFAULT false,
    tags JSONB DEFAULT '[]'::jsonb
);

-- For fast ancestry walks
CREATE INDEX ON messages(parent_id);
CREATE INDEX ON messages(branch_id, created_at);

-- Vector storage (pgvector)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE embeddings (
    message_id UUID PRIMARY KEY REFERENCES messages(id),
    embedding vector(384) NOT NULL   -- dimension matches all-MiniLM-L6-v2
);
```

Additional tables for lens presets, merges, etc. can be added later.

## 3. Service Endpoints (REST/GraphQL)

Charcoal exposes a HTTP API. The frontend (Anima UI) calls these endpoints at the appropriate times.

### 3.1 Append a message

**`POST /api/messages`**

Request body:
```json
{
    "branchId": "optional-uuid",   // if omitted, use the currently active branch from session
    "parentId": "optional-uuid",   // usually the previous message on that branch; if omitted, deduced from branch head
    "role": "user" or "assistant",
    "content": "the message text"
}
```

Response:
```json
{
    "messageId": "new-uuid",
    "context": [                    // assembled messages according to the active lens
        {"role": "...", "content": "..."},
        ...
    ]
}
```

The service:
- Stores the message.
- Updates the branch’s `head_id`.
- Triggers the Scribe (async) to compute embedding and tags.
- Executes the **lens** algorithm (see §4) to produce the context that should be sent to the LLM.

The frontend then uses this `context` (plus the new user message if not already included) as the prompt for the LLM.

### 3.2 Get context

**`GET /api/context?branchId=&messageId=&lens=`**

Used when the frontend already has the message stored and just needs the context (e.g., when switching branches). Returns the same array of messages as above.

### 3.3 Branch management

**`POST /api/branches`** – create a new branch

Body:
```json
{
    "name": "optional name",
    "sourceBranchId": "uuid",   // branch to fork from
    "sourceMessageId": "uuid"   // point in history where to fork (defaults to head)
}
```

Returns the new branch ID.

**`POST /api/branches/:id/merge`** – merge one branch into another

Body:
```json
{
    "sourceBranchId": "uuid",
    "strategy": "fast-forward"   // later: "three-way", etc.
}
```

Merging is a complex operation; for MVP we can implement a simple “copy all messages from source into target” or create a merge commit.

### 3.4 Lens configuration

Lens parameters (recency limit, anchor inclusion, semantic limit, tag filter, max tokens) are stored per user or per branch. Endpoints to read/update them are straightforward.

In the MVP we can use a global default lens.

## 4. Lens Algorithm (Context Assembly)

When a message is appended, Charcoal computes the context as follows:

1. **Current branch head** (before the new message) is `H`.
2. **Linear recent:** Walk `parent_id` backwards from `H` to collect up to `L` messages (configurable, default 20).
3. **Anchors:** If enabled, walk the entire ancestry from `H` and collect all messages where `is_anchor = true`.
4. **Semantic similarity:** Compute embedding of the new message (or of the concatenated recent context). Query `embeddings` via pgvector for the top `S` messages (default 5) with highest cosine similarity, excluding those already collected. (Optionally filter by `branch_id` or tags.)
5. **Combine, sort chronologically, apply token limit** (token estimation using a simple heuristic, e.g., length/4).
6. **Return** the list of messages, each with `role` and `content`.

The new message itself is **not** included in the context; the caller (frontend) will append it before sending to the LLM.

## 5. The Scribe (Background Worker)

The Scribe listens for new messages (via a queue or a Postgres LISTEN/NOTIFY) and performs:

- **Embedding generation** – using the Ollama embedding model (e.g., `nomic-embed-text`) or the local `all-MiniLM-L6-v2` via Transformers.js. Stores result in `embeddings` table.
- **Tag suggestion** – optionally calls a small Ollama LLM to propose tags for the message. Tags are stored in the `tags` JSONB array (the user can later accept/reject via UI, but that’s future).
- **Topic detection** – if a message appears to start a new topic, the Scribe can automatically suggest creating a new branch. This can be exposed to the UI (e.g., a “Start new thread” button) rather than auto‑creating.

All Scribe tasks are asynchronous and do not block the main request.

## 6. Integration with Anima

Your existing Docker‑compose includes:

- **PostgreSQL** with pgvector
- **Ollama** (for embeddings and small LLMs)
- Possibly **Redis** (for queue) – if not, we can use Postgres as a job queue.

Charcoal will be a separate service (Node.js/Bun) that connects to these resources. It exposes a REST API that the Anima frontend (or a proxy) calls.

```yaml
# docker-compose.yml excerpt
services:
  charcoal:
    build: .
    ports: ["3000:3000"]
    environment:
      DATABASE_URL: postgresql://postgres:...@db:5432/charcoal
      OLLAMA_EMBEDDING_URL: http://ollama:11434/api/embeddings
      OLLAMA_LLM_URL: http://ollama:11434/api/generate   # for tag suggestions
    depends_on:
      - db
      - ollama
```

## 7. Implementation Plan

### Phase 0 – Core database and message append
- Set up Postgres schema.
- Implement `POST /api/messages` that stores a message and returns a static context (just the last 10 messages).
- No embeddings, no branches.

### Phase 1 – Branching
- Add branch table and fork/merge endpoints.
- Modify append to respect branch head.

### Phase 2 – Anchors and lens parameters
- Add `is_anchor` and lens configuration.
- Implement the full lens algorithm (linear + anchors).
- Simple token counting.

### Phase 3 – Semantic search
- Integrate Ollama for embeddings.
- Scribe worker (embedding generation, possibly tag suggestion).
- Extend lens algorithm with semantic retrieval.

### Phase 4 – UI integration (outside Charcoal)
- Enhance Anima frontend to call Charcoal endpoints.
- Add UI elements for branching, merging, pinning messages (anchors), and lens selection.

## 8. Name

**Charcoal** – because it filters the raw log into pure, focused context, just as binchotan charcoal purifies water. It’s short, memorable, and already part of the vocabulary.

---

This specification describes a service, not a CLI. It integrates with your existing stack and requires no change to the way users talk to the AI. The frontend (which you already have) will be extended to call Charcoal’s APIs; the user will see at most a few extra buttons (fork, merge, pin) – but the conversation itself remains natural.

Let’s build it.
