import '../tracing.js';
import { startObservation } from "@langfuse/tracing";
import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';
const client = new Anthropic();

export async function sendMessageToClaude(systemPrompt: string | undefined, tools: Anthropic.Tool[], messages: Anthropic.MessageParam[], think: boolean): Promise<Anthropic.Message> {
    const generation = startObservation(
        "claude-messages-create",
        { model: 'claude-sonnet-5', input: messages },
        { asType: "generation" }
    );

    const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: 'claude-sonnet-5',
        max_tokens: think ? 4096 : 1024,
        tools: tools,
        messages: messages,
        thinking: think ? { type: "adaptive" } : { type: "disabled" }
    };

    if (systemPrompt !== undefined) {
        params.system = systemPrompt;
    }

    if (think) {
        params.output_config = { effort: "medium" };
    }

    const response = await client.messages.create(params);

    generation.update({ output: response.content }).end();
    return response;
}