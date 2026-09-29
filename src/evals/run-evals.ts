import Anthropic from '@anthropic-ai/sdk';
import { tools } from '../services/tool_use.js';
import { searchSimilarChunks, answerWithRAG } from '../services/rag.js';
import { sendMessageToClaude } from '../services/claude.js';
import 'dotenv/config';

const client = new Anthropic();

interface ToolCase {
    question: string;
    expectedTool: string | null; // no tool should be called
    expectedBehavior: string; // human-readable description of what a correct answer looks like
}

interface RAGEvalCase {
    question: string;
    expectedSourceContains: string; // a keyword/phrase that SHOULD appear in retrieved chunks
    expectedAnswerContains?: string; // optional — a keyword/phrase the final answer should mention
    shouldFindAnswer: boolean; // false = testing that it correctly says "I don't know" for out-of-scope questions
}

const toolSet: ToolCase[] = [
    { question: "What's the weather in Karachi?", expectedTool: "get_weather", expectedBehavior: "Should call weather tool with city=Karachi" },
    { question: "What's the latest news on AI regulation?", expectedTool: "web_search", expectedBehavior: "Should call web_search, not answer from training data" },
    { question: "My favourite sports is Football", expectedTool: "save_memory", expectedBehavior: "Should call save_memory, because it's a fact" },
    { question: "What is 2+2?", expectedTool: null, expectedBehavior: "Should answer directly, no tool needed" }
];

const ragEvalSet: RAGEvalCase[] = [
    {
        question: "What does the document say about Page Designer integration?",
        expectedSourceContains: "Page Designer",
        expectedAnswerContains: "Page Designer",
        shouldFindAnswer: true
    },
    {
        question: "What is the capital of Spain?",
        expectedSourceContains: "",
        shouldFindAnswer: false
    }
];

async function runToolEvals(): Promise<void> {
    for (const testCase of toolSet) {
        const response = await client.messages.create({
            model: 'claude-sonnet-5',
            max_tokens: 1024,
            tools: tools,
            messages: [{ role: 'user', content: testCase.question }]
        });

        const toolUsed = response.content.find(b => b.type === 'tool_use')?.name ?? null;
        const pass = toolUsed === testCase.expectedTool;
        console.log(`${pass ? '✅' : '❌'} "${testCase.question}" — expected: ${testCase.expectedTool}, got: ${toolUsed}`);
    }
}

async function runRAGEvals(): Promise<void> {
    for (const testCase of ragEvalSet) {
        const matches = await searchSimilarChunks(testCase.question, 8);

        // Test 1: retrieval check
        const retrievalPass = matches.some(m =>
            m.chunk_text.toLowerCase().includes(testCase.expectedSourceContains.toLowerCase())
        );

        // Test 2: generation check
        const prompt = await answerWithRAG(testCase.question);
        let answer: string | null = null;

        if (prompt) {
            const response = await sendMessageToClaude(undefined, tools, [{ role: 'user', content: prompt }], false);
            const textBlock = response.content.find(b => b.type === 'text');
            answer = textBlock?.type === 'text' ? textBlock.text : null;
        }

        const answerPass = testCase.shouldFindAnswer
            ? answer?.toLowerCase().includes((testCase.expectedAnswerContains ?? "").toLowerCase()) ?? false
            : (answer?.toLowerCase().includes("don't") || answer?.toLowerCase().includes("doesn't contain")) ?? false;

        console.log(`${retrievalPass ? '✅' : '❌'} Retrieval: "${testCase.question}"`);
        console.log(`${answerPass ? '✅' : '❌'} Generation: "${testCase.question}"`);
        console.log(`   Top match similarity: ${matches[0]?.similarity.toFixed(3)}`);
        console.log(`   Answer: ${answer?.slice(0, 150)}...`);
    }
}

runToolEvals();
runRAGEvals();