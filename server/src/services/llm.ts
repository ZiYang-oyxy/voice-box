import type { ConversationMessage, LanguageHint } from "../types.js";
import { config, openai } from "./openaiClient.js";

type GenerateAssistantResponseParams = {
  conversation: ConversationMessage[];
  userText: string;
  languageHint: LanguageHint;
  signal: AbortSignal;
};

const BASE_SYSTEM_PROMPT = [
  "You are a fast voice assistant for a local macOS app.",
  "Reply concisely for speech output.",
  "Prefer 2-6 short sentences unless the user asks for more detail.",
  "Match the user's language automatically, defaulting to Chinese when ambiguous."
].join(" ");

export async function generateAssistantResponse({
  conversation,
  userText,
  languageHint,
  signal
}: GenerateAssistantResponseParams): Promise<string> {
  const systemPrompt = buildSystemPrompt(languageHint);
  const transcriptContext = conversation
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.text}`)
    .join("\n");

  const input = [
    systemPrompt,
    "",
    "Conversation so far:",
    transcriptContext || "(empty)",
    "",
    `User: ${userText}`,
    "Assistant:"
  ].join("\n");

  const response = await openai.responses.create(
    {
      model: config.llmModel,
      input,
      max_output_tokens: 420,
      temperature: 0.7
    },
    { signal }
  );

  const outputText = extractOutputText(response);
  if (!outputText) {
    throw new Error("LLM returned empty content");
  }

  return outputText;
}

function buildSystemPrompt(languageHint: LanguageHint): string {
  if (languageHint === "zh") {
    return `${BASE_SYSTEM_PROMPT} Answer in Simplified Chinese.`;
  }

  if (languageHint === "en") {
    return `${BASE_SYSTEM_PROMPT} Answer in English.`;
  }

  return BASE_SYSTEM_PROMPT;
}

function extractOutputText(response: unknown): string {
  const anyResponse = response as {
    output_text?: string;
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
  };

  if (typeof anyResponse.output_text === "string" && anyResponse.output_text.trim()) {
    return anyResponse.output_text.trim();
  }

  const chunks: string[] = [];
  for (const item of anyResponse.output ?? []) {
    if (item.type !== "message") {
      continue;
    }

    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim();
}
