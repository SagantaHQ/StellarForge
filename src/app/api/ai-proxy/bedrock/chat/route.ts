import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/ai-proxy/bedrock/chat
 *
 * Proxies chat completion requests to Amazon Bedrock.
 *
 * Bedrock requires AWS credentials (access key + secret key + region) and
 * SigV4 signing. The user provides their AWS credentials as the "apiKey"
 * in the format: "AKIA...:secretKey:us-east-1" (accessKey:secretKey:region).
 *
 * The proxy uses @aws-sdk/client-bedrock-runtime to call the model.
 *
 * Body:
 *   {
 *     apiKey: string,     // "accessKey:secretKey:region"
 *     model: string,      // Bedrock model ID (e.g. "anthropic.claude-3-5-sonnet-20241022-v2:0")
 *     messages: ChatMessage[],
 *     opts?: { temperature?, maxTokens? }
 *   }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, model, messages, opts } = body as {
      apiKey: string;
      model: string;
      messages: ChatMessage[];
      opts?: { temperature?: number; maxTokens?: number; signal?: never };
    };

    if (!apiKey || !model || !messages) {
      return NextResponse.json(
        { error: "Missing apiKey, model, or messages" },
        { status: 400 }
      );
    }

    // Parse the API key: "accessKey:secretKey:region"
    const parts = apiKey.split(":");
    if (parts.length < 3) {
      return NextResponse.json(
        { error: "Invalid API key format. Use: accessKey:secretKey:region" },
        { status: 400 }
      );
    }
    const accessKeyId = parts[0];
    const secretAccessKey = parts[1];
    const region = parts[2] || "us-east-1";

    // Dynamically import the AWS SDK (heavy — only loaded when Bedrock is used)
    // The SDK may not be installed; we catch the import error + return a
    // helpful message telling the user to install it.
    // @ts-ignore — module may not be installed
    let bedrockRuntime: any;
    try {
      // @ts-ignore
      bedrockRuntime = await import("@aws-sdk/client-bedrock-runtime");
    } catch {
      return NextResponse.json(
        {
          error: "AWS SDK not installed. Run: npm install @aws-sdk/client-bedrock-runtime",
        },
        { status: 500 }
      );
    }

    const { BedrockRuntimeClient, InvokeModelCommand } = bedrockRuntime;

    const client = new BedrockRuntimeClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    // Convert messages to the format expected by the model.
    // For Anthropic Claude models on Bedrock, use the Messages API format.
    // For other models (Llama, Mistral, etc.), use a simple prompt format.
    const isClaude = model.startsWith("anthropic.claude");

    let requestBody: Record<string, unknown>;

    if (isClaude) {
      // Claude Messages API
      const systemMessage = messages.find((m) => m.role === "system");
      const conversationMessages = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      requestBody = {
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: opts?.maxTokens ?? 4096,
        temperature: opts?.temperature ?? 0.7,
        messages: conversationMessages,
        ...(systemMessage ? { system: systemMessage.content } : {}),
      };
    } else {
      // Generic format for Llama, Mistral, etc.
      const prompt = messages.map((m) => {
        if (m.role === "system") return m.content;
        if (m.role === "user") return `Human: ${m.content}`;
        return `Assistant: ${m.content}`;
      }).join("\n\n") + "\n\nAssistant:";

      requestBody = {
        prompt,
        max_gen_len: opts?.maxTokens ?? 4096,
        temperature: opts?.temperature ?? 0.7,
      };
    }

    const command = new InvokeModelCommand({
      modelId: model,
      body: JSON.stringify(requestBody),
      contentType: "application/json",
      accept: "application/json",
    });

    const response = await client.send(command);

    // Parse the response (format varies by model)
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    let content: string;
    let usage: { inputTokens?: number; outputTokens?: number } = {};

    if (isClaude) {
      content = responseBody.content?.map((c: { text?: string }) => c.text).join("") ?? "";
      usage = {
        inputTokens: responseBody.usage?.input_tokens,
        outputTokens: responseBody.usage?.output_tokens,
      };
    } else {
      // Llama / Mistral format
      content = responseBody.generation ?? responseBody.outputs?.[0]?.text ?? "";
      usage = {
        inputTokens: responseBody.prompt_token_count,
        outputTokens: responseBody.generation_token_count,
      };
    }

    return NextResponse.json({
      content,
      model,
      usage,
      finishReason: responseBody.stop_reason ?? "stop",
    });
  } catch (err) {
    console.error("[bedrock-proxy] error:", err);
    const message = err instanceof Error ? err.message : String(err);
    // Return the actual error message as a 400 (not 500) so the client
    // shows the real error instead of a generic "proxy: 400"
    const status = message.includes("Missing") || message.includes("Invalid") ? 400 : 500;
    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
