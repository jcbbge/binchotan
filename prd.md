
The memory system is **completely invisible**—a silent, automatic layer that processes **every turn** (user and AI) as it flows through the conversation, with **zero cognitive overhead**. The user and AI **only ever see raw chat**. Everything else—distillation, assertion graph, projection, branching—happens **under the hood**, via **automatic hooks** in your existing infrastructure.

The web results confirm this is not only possible but **already being prototyped** in multiple systems. Let’s align your **Anima stack** with these patterns—**without user intervention**.

---

## ✅ Core Principle: **Automatic, Hook-Driven Memory**

Your system must trigger **on every turn** via one or more of the following **existing mechanisms** in your stack:

1. **Chat log append** → file watcher
2. **PostgreSQL write** → `LISTEN/NOTIFY` or logical replication
3. **Ollama API call** → middleware proxy
4. **Application hook** → event emitter in your chat harness

You **do not need to choose one**. You can **combine all** for robustness.

---

## 🔗 Validation from the Field

The search results show **multiple independent efforts** converging on **invisible, hook-based memory**:

### 1. **Forky’s Git-Style History** ([ishan.rs](https://ishan.rs/posts/forky-git-style-llm-history))
> “Treat chat history as a file… unlock Git-style interactions.”
> → **Key insight**: The log is the source. Branching is metadata.
> → **Your alignment**: `chat.log` is the diamond. Forking is `forks_from` in assertions.

### 2. **Git-Style Cherry Picking** ([codesolvent.com](https://blog.codesolvent.com/2025/01/applying-forkjoin-model-and-git-style.html))
> “Pick conversations across sessions… build context without rebuilding.”
> → **Key insight**: Memory is **reusable context**, not storage.
> → **Your alignment**: Projection = cherry-picked, relevant assertions.

### 3. **LangGraph’s `Send` API** ([langchain-ai](https://github.com/langchain-ai/langgraph/discussions/632))
> “Support branching with custom copies/views of the state.”
> → **Key insight**: Forking is **state cloning + metadata**.
> → **Your alignment**: Fork = new assertion with `forks_from`.

### 4. **LangChain’s Message History** ([js.langchain.com](https://js.langchain.com/docs/how_to/message_history))
> “Automatic compression of long conversations, virtual filesystem.”
> → **Key insight**: Memory is **virtualized context**, not raw tokens.
> → **Your alignment**: Virtual context = projected assertion slice.

### 5. **Promptfoo’s Multi-Turn Fixtures** ([promptfoo.dev](https://promptfoo.dev/docs/configuration/chat))
> “Conversation history as a fixture for all tests.”
> → **Key insight**: History is **structured data**, not decorative text.
> → **Your alignment**: Assertions = structured, queryable history.

---

## 🧠 Your Implementation: **Silent, Automatic, Multi-Hook**

Given your **Anima Docker stack** (PostgreSQL + pgvector + Ollama), here’s how to make it **100% invisible**:

### 🔄 Hook 1: **On Chat Log Append** (File Watcher)
- Every time your chat app writes a line to `chat.log`:
  - A **Bun watcher** triggers `scribe.ts`.
  - `scribe.ts` sends the turn to **Ollama LLM** for distillation.
  - Inserts assertion into **PostgreSQL**.

### 🔄 Hook 2: **On Database Insert** (PostgreSQL `NOTIFY`)
- Your chat app inserts raw messages into a `messages` table.
- Use a **PostgreSQL trigger**:
  ```sql
  CREATE TRIGGER on_message_insert
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_scribe();
  ```
- `notify_scribe()` sends `NOTIFY scribe, 'new_message'`.
- Bun listens via `LISTEN scribe` and triggers distillation.

### 🔄 Hook 3: **On Ollama API Call** (Proxy Middleware)
- Route all Ollama calls through a **Bun proxy**.
- On **user → AI** request: capture user message.
- On **AI → user** response: capture AI message.
- Auto-distill **both** into assertions.

### 🔄 Hook 4: **Application-Level Event** (In-Code Hook)
- In your chat app, emit an event on every turn:
  ```ts
  eventBus.emit('turn', { agent, content, timestamp });
  ```
- `scribe.ts` listens and processes.

> **Use all four** for redundancy. If one fails, others catch it.

---

## 🧩 What Happens Automatically

| Event | Action | User Aware? |
|------|--------|-------------|
| User sends message | → Log append → Scribe distills → DB insert | ❌ No |
| AI sends response | → Log append → Scribe distills → DB insert | ❌ No |
| New assertion created | → Vectorized → Stored in `assertions` table | ❌ No |
| Context needed for next turn | → `project.ts` queries + projects | ❌ No |
| Divergent topic detected | → Auto-fork via `forks_from` metadata | ❌ No |

**No commands. No syntax. No UI.**
Just **pure, automatic cognition**.

---

## 🧪 Why This Works

- **Forky** proves branching is valuable—but requires user action.
- **Your system** makes it **automatic**: the scribe detects topic shifts and forks **silently**.
- **LangGraph** shows state cloning is possible—but requires code.
- **Your system** does it via **assertion relations**.
- **LangChain** offers compression—but as a feature.
- **Your system** makes it **fundamental**: projection *is* memory.

---

## 🚀 Final Architecture

```
[User] ↔ [Chat App] ↔ [Ollama Proxy]
                     ↕
               [chat.log] ← File Watcher
                     ↕
             [PostgreSQL Trigger]
                     ↕
               [Bun Scribe] → [Ollama LLM] → [pgvector]
                     ↕
             [Assertion Graph] ← Immutable
                     ↕
             [Projector] → [Next Context]
```

**The user sees only the top line.**
Everything else is **binchotan charcoal**—silent, purifying, essential.

---

You don’t need to tell the user to `/fork`.
The system **detects divergence** and **forks automatically**.
You don’t need to `/lens`.
The system **projects the right context** based on the current turn.

This is **true invisible memory**.

Shall we design the **automatic fork detection heuristic**?
