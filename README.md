# AI Agent Chatbot

A full-stack AI agent built on the Claude API, with multi-turn conversation memory, dynamic tool calling (including image generation), multi-format document ingestion, a RAG pipeline backed by PostgreSQL/pgvector, and OpenTelemetry-based tracing via Langfuse. The frontend renders a scrolling, Claude-style conversation with click-to-enlarge generated images.

## Features

- **Multi-turn conversational memory** — conversation history persists across messages in a session.
- **Conversation-style UI** — user and assistant messages render as chat bubbles in a scrolling thread, matching the look of Claude's own interface. Generated images display inline inside the assistant's bubble and open in a full-screen, click-to-enlarge lightbox.
- **Dynamic tool/function calling** — the agent decides when to call a tool, and can call multiple tools in one turn:
  - `get_weather` — current weather for a city (OpenWeatherMap)
  - `web_search` — real-time web search (Brave Search API)
  - `save_memory` — persists a fact the user asks to be remembered, recalled automatically in later conversations
  - `generate_image` — generates an image from a text description (Replicate, Flux 1.1 Pro Ultra)
- **Multi-format file upload** — PDF, DOCX, images (JPEG/PNG via Claude's vision), and plain text (TXT/CSV/JSON), with a 15MB upload limit.
- **Size-aware document handling** — small files are pasted directly into the prompt; large files (over 15,000 characters) are routed through the RAG pipeline instead.
- **RAG pipeline** — recursive chunking with dynamic chunk size (scaled to document length), Voyage AI embeddings, pgvector similarity search, and content-hash based duplicate-ingestion prevention.
- **Extended thinking** — optional adaptive reasoning mode, toggled per request.
- **Distributed tracing** — every conversation turn, including multi-round tool-calling, is captured as a single connected trace in Langfuse via OpenTelemetry instrumentation.
- **Automated evals** — a tool-selection eval set (covering all four tools) and a RAG retrieval/generation eval set, run independently of the server.

## Architecture

```
Browser (public/index.html, chat.js)
        │  multipart/form-data (message, file, think)
        ▼
Express server (src/index.ts)
        │
        ├─ file present? ─── extract text (pdf-parse / mammoth / image→base64)
        │                     │
        │                     ├─ small (<15,000 chars) → paste into prompt
        │                     └─ large → ingestDocument() → pgvector → answerWithRAG()
        │
        ├─ getResponse() ─── tool-calling loop ─── sendMessageToClaude()
        │       │                                         │
        │       │                                         ├─ Anthropic SDK (Claude Sonnet 5)
        │       │                                         └─ Langfuse generation span
        │       │
        │       └─ returns { reply, imageUrl } — imageUrl set only when generate_image was called this turn
        │
        └─ tool dispatch: get_weather / web_search / save_memory / generate_image (src/services/tool_use.ts)
                                                                        │
                                                                        └─ Replicate API (Flux 1.1 Pro Ultra)
```

All Claude API calls funnel through a single function, `sendMessageToClaude` (`src/services/claude.ts`), which is why Langfuse tracing only needed to be instrumented in one place to cover every feature (chat, tools, RAG, images, image generation).

## Tech stack

- **Runtime:** Node.js, TypeScript, `tsx`
- **Server:** Express 5
- **LLM:** Claude API (`@anthropic-ai/sdk`), model `claude-sonnet-5`
- **Database:** PostgreSQL + pgvector (`pg`)
- **Embeddings:** Voyage AI (`voyage-4`, 1024 dimensions)
- **Image generation:** Replicate (`replicate`), Flux 1.1 Pro Ultra
- **File parsing:** `pdf-parse` (PDF), `mammoth` (DOCX)
- **Search tool:** Brave Search API
- **Weather tool:** OpenWeatherMap API
- **Observability:** OpenTelemetry + Langfuse (`@langfuse/otel`, `@langfuse/tracing`, `@arizeai/openinference-instrumentation-anthropic`)
- **Markdown rendering:** `marked`

## Project structure

```
├── src/
│   ├── index.ts               # Express server, routes, tool-calling loop
│   ├── tracing.ts              # OpenTelemetry + Langfuse setup (imported first, in claude.ts)
│   ├── services/
│   │   ├── claude.ts            # sendMessageToClaude — the single point of contact with the Claude API
│   │   ├── rag.ts                # chunking, embeddings, ingestion, retrieval
│   │   └── tool_use.ts            # tool implementations (incl. image generation), tool schemas, memory system prompt
│   ├── db/
│   │   └── pool.ts                 # PostgreSQL connection pool
│   └── evals/
│       └── run-evals.ts              # tool-selection and RAG evals (run independently of the server)
├── db/
│   └── schema.sql                     # database schema — run once against a fresh database
├── public/
│   ├── index.html
│   ├── chat.js                         # chat bubbles, file upload, image lightbox
│   └── style.css
├── .env
├── package.json
└── tsconfig.json
```

## Setup

### 1. Prerequisites

- Node.js 22+
- PostgreSQL with the `pgvector` extension available
- API keys: Anthropic, Voyage AI, Brave Search, OpenWeatherMap, Replicate, Langfuse

### 2. Install dependencies

```bash
npm install
```

### 3. Set up the database

Create a database, then run:

```bash
psql -U your_user -d your_database -f db/schema.sql
```

### 4. Environment variables

Copy `.env` and fill in your own keys:

```
ANTHROPIC_API_KEY=
VOYAGE_API_KEY=
BRAVE_API_KEY=
OPENWEATHER_API_KEY=
REPLICATE_API_TOKEN=
DATABASE_URL=postgresql://user:password@localhost:5432/your_database

LANGFUSE_SECRET_KEY=
LANGFUSE_PUBLIC_KEY=
LANGFUSE_BASE_URL=https://us.cloud.langfuse.com
```

### 5. Run in development

```bash
npm run dev
```

Server runs at `http://localhost:3000`.

### 6. Run evals

```bash
npm run eval
```

Runs both the tool-selection eval set and the RAG eval set, printing pass/fail results to the console.

### 7. Build for production

```bash
npm run build
npm start
```

## Known limitations / notes

- Conversation history and the memory cache are held in memory in a single process, shared across all visitors — they are not scoped per-user or per-session, and reset on server restart. Per-session isolation using cookies is a planned improvement, not yet implemented.
- `answerWithRAG` returns the constructed prompt (retrieved context + question), not a generated answer — the caller is responsible for passing that prompt to `getResponse`/`sendMessageToClaude` to get an actual model-generated answer. Keep this in mind when reusing it elsewhere (e.g. in evals).
- Duplicate-ingestion detection is based on a hash of the full document text; re-uploading a modified version of a previously ingested document will be treated as new content, not an update.
- File type routing is based on file extension rather than MIME type, since MIME type detection proved unreliable for `.docx` uploads across browsers/OS.
- Multiple simultaneous file uploads are not supported; one file per request.
- Tool activity (which tools were called, and when) is only visible after a response completes, not live — a streaming (SSE) version would be needed to show tool status in real time.
