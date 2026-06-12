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
 *
 * `timeoutMs` is an **inactivity** timeout: the stream is aborted only if no
 * data (or no initial response) arrives within the window. The timer resets on
 * every chunk, so a long-but-healthy stream is never cut off. Pass
 * `externalSignal` (e.g. wired to the HTTP client disconnecting) to stop
 * generating early — the upstream request is aborted and the generator returns
 * quietly without raising.
 */
export async function* streamChatCompletion(
  messages: ChatMessage[],
  config: LLMConfig,
  externalSignal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const controller = new AbortController();

  // Inactivity watchdog: (re)armed on connect and on every chunk.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), config.timeoutMs);
  };

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: true,
  };
  if (config.temperature !== undefined) body.temperature = config.temperature;
  if (config.maxTokens !== undefined) body.max_tokens = config.maxTokens;

  try {
    arm();
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
      // Client went away — stop quietly, this isn't an error worth surfacing.
      if (externalSignal?.aborted) return;
      const e = err as Error;
      if (e.name === "AbortError") {
        throw new LLMError(
          `LLM request timed out after ${config.timeoutMs}ms of inactivity`,
        );
      }
      throw new LLMError(`could not reach LLM at ${config.baseUrl}: ${e.message}`);
    }

    if (!response.ok || !response.body) {
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
        arm(); // healthy data — reset the inactivity watchdog
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
    } catch (err) {
      if (externalSignal?.aborted) return; // client disconnected mid-stream
      const e = err as Error;
      if (e.name === "AbortError") {
        throw new LLMError(
          `LLM stream timed out after ${config.timeoutMs}ms of inactivity`,
        );
      }
      throw err;
    }
  } finally {
    if (timer) clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}
