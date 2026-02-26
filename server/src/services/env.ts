import { z } from "zod";

const schema = z.object({
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_BASE_URL: z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }

      const trimmed = value.trim();
      return trimmed === "" ? undefined : trimmed;
    },
    z.string().url("OPENAI_BASE_URL must be a valid URL").optional()
  ),
  OPENAI_STT_MODEL: z.string().default("gpt-4o-mini-transcribe"),
  OPENAI_LLM_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_TTS_MODEL: z.string().default("gpt-4o-mini-tts"),
  DEFAULT_VOICE: z.string().default("marin"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  SAVE_HISTORY: z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return true;
      }

      return value.toLowerCase() !== "false";
    })
});

export type AppConfig = {
  openaiApiKey: string;
  openaiBaseUrl?: string;
  sttModel: string;
  llmModel: string;
  ttsModel: string;
  defaultVoice: string;
  host: string;
  port: number;
  saveHistory: boolean;
};

export function loadConfig(): AppConfig {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }

  return {
    openaiApiKey: parsed.data.OPENAI_API_KEY,
    openaiBaseUrl: parsed.data.OPENAI_BASE_URL,
    sttModel: parsed.data.OPENAI_STT_MODEL,
    llmModel: parsed.data.OPENAI_LLM_MODEL,
    ttsModel: parsed.data.OPENAI_TTS_MODEL,
    defaultVoice: parsed.data.DEFAULT_VOICE,
    host: parsed.data.HOST,
    port: parsed.data.PORT,
    saveHistory: parsed.data.SAVE_HISTORY
  };
}
