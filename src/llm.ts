import type { ChatMessage } from "./types";
import type { LLMConfig } from "./config";

export class LLMError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
}

/**
 * Stream a chat completion from any OpenAI-compatible endpoint.
 *
 * Yields content deltas as they arrive. Works against OpenAI, Ollama,
 * koboldcpp, text-generation-webui, and Anthropic-compatible proxies — they all
 * speak the `POST {baseUrl}/chat/completions` SSE protocol.
 */
export async function* streamChatCompletion(
  messages: ChatMessage[],
  config: LLMConfig,
): AsyncGenerator<string, void, unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: true,
  };
  if (config.temperature !== undefined) body.temperature = config.temperature;
  if (config.maxTokens !== undefined) body.max_tokens = config.maxTokens;

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const e = err as Error;
    if (e.name === "AbortError") {
      throw new LLMError(`LLM request timed out after ${config.timeoutMs}ms`);
    }
    throw new LLMError(`could not reach LLM at ${config.baseUrl}: ${e.message}`);
  }

  if (!response.ok || !response.body) {
    clearTimeout(timeout);
    const detail = await response.text().catch(() => "");
    throw new LLMError(
      `LLM returned ${response.status} ${response.statusText}${
        detail ? `: ${detail.slice(0, 500)}` : ""
      }`,
      response.status,
    );
  }

  const decoder = new TextDecoder();
  let buffer = "";
  try {
    // response.body is a web ReadableStream; async-iterate it.
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      // SSE frames are separated by blank lines.
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line || !line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const parsed = JSON.parse(payload) as ChatCompletionChunk;
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // Ignore keep-alives / partial frames; the next chunk completes them.
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}
