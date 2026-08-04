import { NextRequest, NextResponse } from "next/server";

/**
 * §9.10 — AI proxy passthrough for CORS-blocked providers.
 *
 * Anthropic blocks direct browser calls via CORS. This route proxies the
 * request server-side. The API key travels with the request body, is used
 * only for this single call, and is NEVER stored or logged.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, model, system, messages, max_tokens, temperature, stop_sequences } = body;

    if (!apiKey || typeof apiKey !== "string") {
      return NextResponse.json({ error: "Missing apiKey" }, { status: 400 });
    }
    if (!model || typeof model !== "string") {
      return NextResponse.json({ error: "Missing model" }, { status: 400 });
    }
    if (!Array.isArray(messages)) {
      return NextResponse.json({ error: "Missing messages" }, { status: 400 });
    }

    // §9.6 — prompt caching: cache the system prompt if substantial
    const systemBlock = system
      ? [
          {
            type: "text",
            text: system,
            ...(system.length > 1000
              ? { cache_control: { type: "ephemeral" } }
              : {}),
          },
        ]
      : undefined;

    const anthropicBody: Record<string, unknown> = {
      model,
      max_tokens: max_tokens ?? 4096,
      messages,
      temperature: temperature ?? 0.7,
    };
    if (systemBlock) anthropicBody.system = systemBlock;
    if (stop_sequences) anthropicBody.stop_sequences = stop_sequences;

    const upstream = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(anthropicBody),
    });

    const responseText = await upstream.text();

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Anthropic API error: ${upstream.status}`, detail: responseText },
        { status: upstream.status }
      );
    }

    const data = JSON.parse(responseText);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Proxy error",
        detail: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
