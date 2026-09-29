import 'dotenv/config';
import { pool } from '../db/pool.js';
import crypto from 'crypto';

const RAG_THRESHOLD_CHARS = 15000;

function shouldUseRAG(text: string): boolean {
    return text.length > RAG_THRESHOLD_CHARS;
}

function hashContent(text: string) {
    return crypto.createHash('sha256').update(text).digest('hex');
}

async function isAlreadyIngested(contentHash: any): Promise<boolean> {
    const result = await pool.query(
        `SELECT 1 FROM document_chunks WHERE content_hash = $1 LIMIT 1`,
        [contentHash]
    );
    return (result.rowCount ?? 0) > 0;
}

function getChunkingParams(textLength: number): { chunkSize: number; overlap: number } {
    if (textLength < 100000) {
        return { chunkSize: 1000, overlap: 200 };   // small-medium docs
    } else if (textLength < 500000) {
        return { chunkSize: 1500, overlap: 250 };   // larger docs
    } else {
        return { chunkSize: 2500, overlap: 400 };   // very large docs
    }
}

function chunkText(text: string, chunkSize: number, overlap: number): string[] {
    // First, try splitting on paragraph boundaries
    const paragraphs = text.split(/\n\s*\n/);
    const chunks = [];
    let currentChunk = "";

    for (const para of paragraphs) {
        if ((currentChunk + para).length <= chunkSize) {
            currentChunk += (currentChunk ? "\n\n" : "") + para;
        } else {
            if (currentChunk) chunks.push(currentChunk);
            // if a single paragraph is itself too long, fall back to hard split
            if (para.length > chunkSize) {
                let start = 0;
                while (start < para.length) {
                    chunks.push(para.slice(start, start + chunkSize));
                    start += chunkSize - overlap;
                }
                currentChunk = "";
            } else {
                currentChunk = para;
            }
        }
    }
    if (currentChunk) chunks.push(currentChunk);

    console.log("Number of chunks created:", chunks.length);
    return chunks;
}

async function getEmbeddings(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            input: texts,
            model: 'voyage-4'
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Voyage API error: ${response.status} - ${errText}`);
    }

    const data: any = await response.json();
    return data.data.map((item: { embedding: number[] }) => item.embedding);
}

async function ingestDocument(fullText: string, sourceFile: string): Promise<void> {
    const contentHash = hashContent(fullText);

    const alreadyExists = await isAlreadyIngested(contentHash);
    if (alreadyExists) {
        console.log(`${sourceFile} already ingested — skipping`);
        return;
    }

    const { chunkSize, overlap } = getChunkingParams(fullText.length);
    console.log("Full text length:", fullText.length);
    const chunks = chunkText(fullText, chunkSize, overlap);
    const embeddings = await getEmbeddings(chunks);

    // Store each chunk and its embedding in the database
    for (let i = 0; i < chunks.length; i++) {
        await pool.query(
            `INSERT INTO document_chunks (source_file, chunk_text, embedding, content_hash) VALUES ($1, $2, $3, $4)`,
            [sourceFile, chunks[i], JSON.stringify(embeddings[i]), contentHash]
        );
    }
    console.log(`Ingested ${chunks.length} chunks from ${sourceFile}`);
}

async function searchSimilarChunks(query: string, topK: number = 8): Promise<{ chunk_text: string; source_file: string; similarity: number }[]> {
    // Embed the query using the SAME model as your document chunks
    const [queryEmbedding] = await getEmbeddings([query]);

    const result = await pool.query(
        `SELECT chunk_text, source_file, 1 - (embedding <=> $1) AS similarity
         FROM document_chunks
         ORDER BY embedding <=> $1
         LIMIT $2`,
        [JSON.stringify(queryEmbedding), topK]
    );

    return result.rows;
}

async function answerWithRAG(userQuestion: string): Promise<string | null> {
    // Retrieve the most relevant chunks
    const matches = await searchSimilarChunks(userQuestion, 8);

    if (matches.length === 0) {
        return "I couldn't find anything relevant in the knowledge base to answer that.";
    }

    // console.log(`\n--- Retrieved ${matches.length} chunks for: "${userQuestion}" ---`);
    // matches.forEach((m, i) => {
    //     console.log(`${i+1}. [similarity: ${m.similarity.toFixed(3)}] ${m.chunk_text.slice(0, 100)}...`);
    // });

    // Build context from retrieved chunks
    const context = matches
        .map((m, i) => `[Chunk ${i + 1} from ${m.source_file}]\n${m.chunk_text}`)
        .join('\n\n---\n\n');

    // Construct a prompt that grounds Claude's answer in ONLY the retrieved context
    const prompt = `Answer the user's question using ONLY the information in the context below. If the context doesn't contain enough information to answer,
    say so clearly rather than guessing. Context: ${context} Question: ${userQuestion}`;

    return prompt;
}

export { shouldUseRAG, ingestDocument, searchSimilarChunks, answerWithRAG };