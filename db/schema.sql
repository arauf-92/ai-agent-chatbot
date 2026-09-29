-- AI Agent Chatbot — Database Schema
-- Run this against a fresh PostgreSQL database with the pgvector extension available.

CREATE EXTENSION IF NOT EXISTS vector;

-- Stores chunked, embedded document content for RAG retrieval.
-- One row per chunk; all chunks from the same source document share the same content_hash,
-- which is used to detect and skip duplicate ingestion of the same document.
CREATE TABLE document_chunks (
    id SERIAL PRIMARY KEY,
    source_file TEXT NOT NULL,
    chunk_text TEXT NOT NULL,
    embedding VECTOR(1024),           -- dimension must match the embedding model in use (Voyage AI, 1024-dim)
    content_hash TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Speeds up similarity search once the table has many rows.
CREATE INDEX ON document_chunks USING ivfflat (embedding vector_cosine_ops);

-- Stores facts the user has explicitly asked the agent to remember via the save_memory tool.
CREATE TABLE memories (
    id SERIAL PRIMARY KEY,
    fact TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
