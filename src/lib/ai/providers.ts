/**
 * §9.2 — AI Provider abstraction layer.
 *
 * Each provider implements:
 *   - listModels(apiKey): Promise<string[]>  — fetch available models
 *   - chat(apiKey, model, messages, opts): Promise<ChatResponse>
 *
 * Browser-direct calls are used where CORS allows (OpenAI, Gemini, OpenRouter,
 * DeepSeek, Kimi, Ollama, Z-AI). For CORS-blocked providers (Anthropic, Bedrock),
 * requests route through the server-side proxy passthrough (§9.10).
 *
 * Keys are stored ONLY in browser IndexedDB (via the ai-keys-store), never sent
 * to our server except as part of the direct provider call (or proxied call).
 */

export type ProviderId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "deepseek"
  | "kimi"
  | "openrouter"
  | "bedrock"
  | "cloudflare"
  | "zai"
  | "ollama"
  | "custom-openai"
  | "other";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** Stop sequences */
  stop?: string[];
  /** Anthropic-style prompt caching marker */
  cacheBreakpoint?: boolean;
  signal?: AbortSignal;
}

export interface ChatResponse {
  content: string;
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  finishReason?: string;
}

export interface Provider {
  id: ProviderId;
  name: string;
  /** Default base URL for direct browser calls */
  baseUrl: string;
  /** Whether the provider blocks browser calls via CORS (requires proxy) */
  requiresProxy: boolean;
  /** Whether the provider supports prompt caching */
  supportsCaching: boolean;
  /** Documentation URL */
  docsUrl: string;
  /** Fetch the list of available models for this provider */
  listModels: (apiKey: string, baseUrl?: string) => Promise<string[]>;
  /** Send a chat completion request */
  chat: (
    apiKey: string,
    model: string,
    messages: ChatMessage[],
    opts?: ChatOptions,
    baseUrl?: string
  ) => Promise<ChatResponse>;
}

// ============================================================
// OpenAI-compatible helpers (used by OpenAI, DeepSeek, Kimi, OpenRouter, Z-AI, custom)
// ============================================================

interface OpenAIChatParams {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  opts?: ChatOptions;
}

async function openaiCompatibleChat({
  apiKey,
  baseUrl,
  model,
  messages,
  opts,
}: OpenAIChatParams): Promise<ChatResponse> {
  const url = `${baseUrl}/chat/completions`;
  const body: Record<string, unknown> = {
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: opts?.temperature ?? 0.7,
    max_tokens: opts?.maxTokens,
    stop: opts?.stop,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: opts?.signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${baseUrl} returned ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return {
    content: data.choices?.[0]?.message?.content ?? "",
    model: data.model ?? model,
    usage: {
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
    },
    finishReason: data.choices?.[0]?.finish_reason,
  };
}

async function openaiCompatibleListModels(
  apiKey: string,
  baseUrl: string
): Promise<string[]> {
  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`listModels failed: ${res.status}`);
  const data = await res.json();
  return (data.data ?? []).map((m: { id: string }) => m.id).sort();
}

// ============================================================
// Anthropic (Claude) — requires proxy due to CORS
// ============================================================

async function anthropicChat(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  opts?: ChatOptions
): Promise<ChatResponse> {
  // Anthropic blocks browser calls — route through server-side proxy (§9.10)
  const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
  const userMessages = messages.filter((m) => m.role !== "system");

  const res = await fetch("/api/ai-proxy/anthropic", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey,
      model,
      system: systemMsg,
      messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: opts?.maxTokens ?? 4096,
      temperature: opts?.temperature ?? 0.7,
      stop_sequences: opts?.stop,
    }),
    signal: opts?.signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic proxy returned ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return {
    content: data.content?.[0]?.text ?? "",
    model: data.model ?? model,
    usage: {
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
      cacheReadTokens: data.usage?.cache_read_input_tokens,
      cacheWriteTokens: data.usage?.cache_creation_input_tokens,
    },
    finishReason: data.stop_reason,
  };
}

async function anthropicListModels(apiKey: string): Promise<string[]> {
  // Anthropic has a fixed set of model families; hardcode the current line-up
  // (their /v1/models endpoint also requires the proxy and isn't fully public)
  void apiKey;
  return [
    "claude-opus-4-5",
    "claude-sonnet-4-5",
    "claude-haiku-4-5",
    "claude-3-7-sonnet-latest",
    "claude-3-5-haiku-latest",
  ];
}

// ============================================================
// Gemini (Google AI Studio) — supports direct browser calls
// ============================================================

async function geminiChat(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  opts?: ChatOptions
): Promise<ChatResponse> {
  const systemMsg = messages.find((m) => m.role === "system")?.content;
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: opts?.temperature ?? 0.7,
      maxOutputTokens: opts?.maxTokens,
      stopSequences: opts?.stop,
    },
  };
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg }] };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: opts?.signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini returned ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return {
    content: data.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
    model,
    usage: {
      inputTokens: data.usageMetadata?.promptTokenCount,
      outputTokens: data.usageMetadata?.candidatesTokenCount,
    },
    finishReason: data.candidates?.[0]?.finishReason,
  };
}

async function geminiListModels(apiKey: string): Promise<string[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
  );
  if (!res.ok) throw new Error(`Gemini listModels failed: ${res.status}`);
  const data = await res.json();
  return (data.models ?? [])
    .filter((m: { supportedGenerationMethods?: string[] }) =>
      m.supportedGenerationMethods?.includes("generateContent")
    )
    .map((m: { name: string }) => m.name.replace("models/", ""))
    .sort();
}

// ============================================================
// Ollama (local) — no API key required, hits localhost
// ============================================================

async function ollamaListModels(): Promise<string[]> {
  const res = await fetch("http://localhost:11434/api/tags");
  if (!res.ok) throw new Error(`Ollama not reachable at localhost:11434`);
  const data = await res.json();
  return (data.models ?? []).map((m: { name: string }) => m.name).sort();
}

async function ollamaChat(
  _apiKey: string,
  model: string,
  messages: ChatMessage[],
  opts?: ChatOptions
): Promise<ChatResponse> {
  const res = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      options: {
        temperature: opts?.temperature ?? 0.7,
        num_predict: opts?.maxTokens,
        stop: opts?.stop,
      },
    }),
    signal: opts?.signal,
  });
  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
  const data = await res.json();
  return {
    content: data.message?.content ?? "",
    model: data.model ?? model,
    usage: {
      inputTokens: data.prompt_eval_count,
      outputTokens: data.eval_count,
    },
    finishReason: data.done ? "stop" : undefined,
  };
}

// ============================================================
// Provider registry
// ============================================================

export const PROVIDERS: Record<ProviderId, Provider> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    requiresProxy: false,
    supportsCaching: true, // implicit caching
    docsUrl: "https://platform.openai.com/docs/api-reference",
    listModels: (k) => openaiCompatibleListModels(k, "https://api.openai.com/v1"),
    chat: (k, m, msg, opts) =>
      openaiCompatibleChat({ apiKey: k, baseUrl: "https://api.openai.com/v1", model: m, messages: msg, opts }),
  },
  anthropic: {
    id: "anthropic",
    name: "Claude (Anthropic)",
    baseUrl: "https://api.anthropic.com",
    requiresProxy: true, // CORS blocks browser calls
    supportsCaching: true, // cache_control
    docsUrl: "https://docs.anthropic.com/en/api/messages",
    listModels: anthropicListModels,
    chat: anthropicChat,
  },
  gemini: {
    id: "gemini",
    name: "Gemini (Google AI Studio)",
    baseUrl: "https://generativelanguage.googleapis.com",
    requiresProxy: false,
    supportsCaching: true, // implicit context caching
    docsUrl: "https://ai.google.dev/gemini-api/docs",
    listModels: geminiListModels,
    chat: geminiChat,
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    requiresProxy: false,
    supportsCaching: true, // automatic context caching
    docsUrl: "https://api-docs.deepseek.com/",
    listModels: (k) => openaiCompatibleListModels(k, "https://api.deepseek.com/v1"),
    chat: (k, m, msg, opts) =>
      openaiCompatibleChat({ apiKey: k, baseUrl: "https://api.deepseek.com/v1", model: m, messages: msg, opts }),
  },
  kimi: {
    id: "kimi",
    name: "Kimi (Moonshot)",
    baseUrl: "https://api.moonshot.cn/v1",
    requiresProxy: false,
    supportsCaching: true, // context caching
    docsUrl: "https://platform.moonshot.cn/docs",
    listModels: (k) => openaiCompatibleListModels(k, "https://api.moonshot.cn/v1"),
    chat: (k, m, msg, opts) =>
      openaiCompatibleChat({ apiKey: k, baseUrl: "https://api.moonshot.cn/v1", model: m, messages: msg, opts }),
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    requiresProxy: false,
    supportsCaching: false,
    docsUrl: "https://openrouter.ai/docs",
    listModels: (k) => openaiCompatibleListModels(k, "https://openrouter.ai/api/v1"),
    chat: (k, m, msg, opts) =>
      openaiCompatibleChat({ apiKey: k, baseUrl: "https://openrouter.ai/api/v1", model: m, messages: msg, opts }),
  },
  bedrock: {
    id: "bedrock",
    name: "Amazon Bedrock",
    baseUrl: "",
    requiresProxy: true, // requires AWS SigV4 signing
    supportsCaching: false,
    docsUrl: "https://docs.aws.amazon.com/bedrock/",
    listModels: async () => {
      // Bedrock model IDs are region-specific and signed — proxy returns a curated list
      const res = await fetch("/api/ai-proxy/bedrock/models");
      if (!res.ok) throw new Error("Bedrock models require proxy");
      return res.json();
    },
    chat: async (apiKey, model, messages, opts) => {
      // Bedrock requires AWS credentials + SigV4; proxy handles signing
      const res = await fetch("/api/ai-proxy/bedrock/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, model, messages, opts }),
        signal: opts?.signal,
      });
      if (!res.ok) throw new Error(`Bedrock proxy: ${res.status}`);
      return res.json();
    },
  },
  cloudflare: {
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    baseUrl: "https://api.cloudflare.com/client/v4",
    requiresProxy: false,
    supportsCaching: false,
    docsUrl: "https://developers.cloudflare.com/workers-ai/",
    listModels: async (_k) => {
      // Cloudflare models are named like "@cf/meta/llama-3.1-8b-instruct"
      return [
        "@cf/meta/llama-3.1-8b-instruct",
        "@cf/meta/llama-3.1-70b-instruct",
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        "@cf/qwen/qwen1.5-14b-chat-awq",
        "@cf/mistral/mistral-7b-instruct-v0.2",
      ];
    },
    chat: async (apiKey, model, messages, opts) => {
      // Cloudflare uses account_id in URL; user must provide it via apiKey as "accountId:apiKey"
      const [accountId, key] = apiKey.split(":");
      if (!accountId || !key) throw new Error("Cloudflare key must be 'accountId:apiKey'");
      const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: opts?.temperature,
          max_tokens: opts?.maxTokens,
        }),
        signal: opts?.signal,
      });
      if (!res.ok) throw new Error(`Cloudflare: ${res.status}`);
      const data = await res.json();
      return {
        content: data.result?.response ?? "",
        model,
        usage: { inputTokens: undefined, outputTokens: undefined },
      };
    },
  },
  zai: {
    id: "zai",
    name: "Z-AI (GLM)",
    baseUrl: "https://api.z.ai/api/paas/v4",
    requiresProxy: false,
    supportsCaching: false,
    docsUrl: "https://docs.z.ai/",
    listModels: async (_k) => {
      return ["glm-4.6", "glm-4.5-air", "glm-4.5", "glm-4-plus", "glm-4-air"];
    },
    chat: (k, m, msg, opts) =>
      openaiCompatibleChat({ apiKey: k, baseUrl: "https://api.z.ai/api/paas/v4", model: m, messages: msg, opts }),
  },
  ollama: {
    id: "ollama",
    name: "Ollama (local)",
    baseUrl: "http://localhost:11434",
    requiresProxy: false,
    supportsCaching: false,
    docsUrl: "https://ollama.com/",
    listModels: () => ollamaListModels(),
    chat: ollamaChat,
  },
  "custom-openai": {
    id: "custom-openai",
    name: "Custom OpenAI-compatible",
    baseUrl: "", // user-provided
    requiresProxy: false,
    supportsCaching: false,
    docsUrl: "",
    listModels: async (k, baseUrl) => openaiCompatibleListModels(k, baseUrl ?? ""),
    chat: (k, m, msg, opts, baseUrl) =>
      openaiCompatibleChat({ apiKey: k, baseUrl: baseUrl ?? "", model: m, messages: msg, opts }),
  },
  other: {
    id: "other",
    name: "Other (generic)",
    baseUrl: "",
    requiresProxy: false,
    supportsCaching: false,
    docsUrl: "",
    listModels: async () => [],
    chat: async () => {
      throw new Error("Generic provider not configured");
    },
  },
};

export const PROVIDER_LIST = Object.values(PROVIDERS);
