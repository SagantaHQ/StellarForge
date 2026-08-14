import { NextResponse } from "next/server";

/**
 * GET /api/ai-proxy/bedrock/models
 *
 * Returns a curated list of Amazon Bedrock models.
 * Bedrock model IDs are region-specific + require AWS SigV4 signing to
 * query the actual Bedrock API, so we return a static curated list instead.
 *
 * The user can also use "Custom model name…" to enter a specific model ID.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BEDROCK_MODELS = [
  // Anthropic Claude models on Bedrock
  "anthropic.claude-3-5-sonnet-20241022-v2:0",
  "anthropic.claude-3-5-haiku-20241022-v1:0",
  "anthropic.claude-3-opus-20240229-v1:0",
  "anthropic.claude-3-sonnet-20240229-v1:0",
  "anthropic.claude-3-haiku-20240307-v1:0",
  // Meta Llama models on Bedrock
  "meta.llama3-1-405b-instruct-v1:0",
  "meta.llama3-1-70b-instruct-v1:0",
  "meta.llama3-1-8b-instruct-v1:0",
  "meta.llama3-70b-instruct-v1:0",
  "meta.llama3-8b-instruct-v1:0",
  // Mistral models on Bedrock
  "mistral.mistral-large-2407-v1:0",
  "mistral.mistral-small-2402-v1:0",
  "mistral.mixtral-8x7b-instruct-v0:1",
  // Amazon models
  "amazon.nova-pro-v1:0",
  "amazon.nova-lite-v1:0",
  "amazon.nova-micro-v1:0",
  // AI21 models
  "ai21.jamba-1-5-large-v1:0",
  "ai21.jamba-1-5-mini-v1:0",
  // Cohere models
  "cohere.command-r-plus-v1:0",
  "cohere.command-r-v1:0",
];

export async function GET() {
  return NextResponse.json(BEDROCK_MODELS);
}
