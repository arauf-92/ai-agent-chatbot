import { startActiveObservation } from "@langfuse/tracing";
import Anthropic from '@anthropic-ai/sdk';
import { RateLimitError, APIError } from '@anthropic-ai/sdk';
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');
import mammoth from 'mammoth';
import { marked } from "marked";

import { sendMessageToClaude } from './services/claude.js';
import { get_weather, performWebSearch, getSystemPrompt, saveMemory, generateImage, tools } from './services/tool_use.js';
import { shouldUseRAG, ingestDocument, answerWithRAG } from './services/rag.js';

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024  // 15MB
  }
});
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const messages: Anthropic.MessageParam[] = [];

function addMessage(role: 'user' | 'assistant', text: Anthropic.MessageParam['content']): void {
  messages.push({ role, content: text });
}

function extractText(response: Anthropic.Message): string | null {
  const thinkingBlock = response.content.find(block => block.type === 'thinking');
  console.log("Thinking block present:", !!thinkingBlock);
  // if (thinkingBlock?.type === 'thinking') {
  //   console.log("Thinking content:", thinkingBlock.thinking.slice(0, 200));
  // }

  const textBlock = response.content.find(block => block.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : null;
}

async function getResponse(text: string | null, think: boolean): Promise<{ reply: string | null; imageUrl: string | null }> {
  return startActiveObservation("chat-turn", async (span) => {
    span.update({ input: { text, think } });

    if (text !== null) {
      addMessage('user', text);
    }
    const systemPrompt = await getSystemPrompt();
    let imageUrl: string | null = null;
    try {
      let response = await sendMessageToClaude(systemPrompt, tools, messages, think);

      while (true) {
        const toolUseBlocks = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
        if (toolUseBlocks.length === 0) break;

        addMessage('assistant', response.content);

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of toolUseBlocks) {
          let result: string;
          switch (block.name) {
            case 'get_weather':
              result = await get_weather((block.input as { city: string }).city);
              break;
            case 'web_search':
              result = await performWebSearch((block.input as { query: string }).query);
              break;
            case 'save_memory':
              result = await saveMemory((block.input as { fact: string }).fact);
              break;
            case 'generate_image':
              const imgUrl = await generateImage((block.input as { prompt: string }).prompt);
              imageUrl = imgUrl;
              result = imgUrl
                ? "Image generated successfully. It will be shown to the user in the interface — do not include the image URL or markdown image syntax in your response."
                : "Image generation failed.";
              break;
            default:
              result = "Unknown tool requested";
          }
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
        }

        addMessage('user', toolResults);
        response = await sendMessageToClaude(systemPrompt, tools, messages, think);
      }

      const replyText = extractText(response);
      if (!replyText) {
        console.error("No text block found in response:", response.content);
        span.update({ output: "No text block found" });
        return { reply: null, imageUrl };
      }
      addMessage('assistant', replyText);
      span.update({ output: replyText });
      return { reply: replyText, imageUrl };

    } catch (error) {
      if (error instanceof RateLimitError) {
        console.error("Rate limit exceeded");
      } else if (error instanceof APIError) {
        console.error(`API error ${error.status}: ${error.message}`);
      } else {
        console.error("Unexpected error: ", (error as Error).message);
      }
      return { reply: null, imageUrl: null };
    }
  });
}

async function imageUpload(file: Express.Multer.File, userText: string, think: boolean): Promise<{ reply: string | null; imageUrl: string | null }> {
  const base64Image = file.buffer.toString('base64');
  addMessage('user', [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: file.mimetype as 'image/jpeg' | 'image/png',
        data: base64Image
      }
    },
    {
      type: 'text',
      text: userText
    }
  ]);
  return getResponse(null, think);
}

function sendReply(res: any, reply: string | null, userText: string, imageUrl: string | null = null): void {
  res.json({ reply: reply ? marked.parse(reply) : null, userQ: userText, img: imageUrl });
}

function sanitizeText(text: string): string {
  return text
    .replace(/\0/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

app.post("/submit", upload.single("file"), async (req, res) => {
  try {
    const userText: string = req.body.message || "";
    const think: boolean = req.body.think === 'true' || req.body.think === true;
    const file = req.file;

    if (file) {
      const ext = path.extname(file.originalname).toLowerCase();
      let fileContents: string;

      if (ext === '.pdf') {
        const parser = new PDFParse({ data: file.buffer });
        const result = await parser.getText();
        fileContents = sanitizeText(result.text);
      } else if (ext === '.docx') {
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        fileContents = sanitizeText(result.value);
      } else if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') {
        const { reply: imgContent, imageUrl } = await imageUpload(file, userText, think);
        return sendReply(res, imgContent, userText, imageUrl);
      } else {
        fileContents = file.buffer.toString("utf8");
      }

      // RAG or direct paste decision
      if (shouldUseRAG(fileContents)) {
        console.log(`Large file (${fileContents.length} chars) — using RAG`);
        try {
          await ingestDocument(fileContents, file.originalname);
          const ansPrompt = await answerWithRAG(userText);
          const { reply: ragAnswer, imageUrl } = await getResponse(ansPrompt, think);
          return sendReply(res, ragAnswer, userText, imageUrl);
        } catch (err) {
          console.error("Ingestion failed:", (err as Error).message);
          return res.status(500).json({ error: "Failed to process this document. It may contain unsupported characters or formatting." });
        }
      } else {
        console.log(`Small file (${fileContents.length} chars) — using direct paste`);
        const combinedText = `${userText}\n\nHere is the attached file content:\n${fileContents}`;
        const { reply, imageUrl } = await getResponse(combinedText, think);
        return sendReply(res, reply, userText, imageUrl);
      }
    }

    // no file — normal chat
    const { reply, imageUrl } = await getResponse(userText, think);
    if (reply) {
      sendReply(res, reply, userText, imageUrl);
    } else {
      res.status(500).json({ error: "Something went wrong" });
    }
  } catch (error) {
    console.error("Unhandled error in /submit:", (error as Error).message);
    res.status(500).json({ error: "Something went wrong processing your request" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
