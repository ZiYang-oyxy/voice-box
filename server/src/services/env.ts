import { z } from "zod";

const schema = z.object({
  OPENAI_API_KEY: z
    .preprocess(
      (value) => {
        if (typeof value !== "string") {
          return value;
        }
        return value.trim();
      },
      z.string().optional()
    )
    .default(""),
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
  DOUBAO_REALTIME_BASE_URL: z
    .string()
    .url("DOUBAO_REALTIME_BASE_URL must be a valid URL")
    .default("wss://openspeech.bytedance.com/api/v3/realtime/dialogue"),
  DOUBAO_APP_ID: z.string().min(1, "DOUBAO_APP_ID is required"),
  DOUBAO_ACCESS_KEY: z.string().min(1, "DOUBAO_ACCESS_KEY is required"),
  DOUBAO_RESOURCE_ID: z.string().default("volc.speech.dialog"),
  DOUBAO_APP_KEY: z.string().default("PlgvMymc7f3tQnJ6"),
  DOUBAO_BOT_NAME: z.string().default("豆包"),
  DOUBAO_SPEAKER: z.string().default("zh_male_yunzhou_jupiter_bigtts"),
  DOUBAO_RECV_TIMEOUT: z.coerce.number().int().min(10).max(120).default(10),
  DOUBAO_INPUT_MOD: z.enum(["audio", "text", "audio_file"]).default("audio"),
  DOUBAO_INPUT_SAMPLE_RATE: z.coerce.number().int().min(8000).max(48000).default(16000),
  DOUBAO_OUTPUT_SAMPLE_RATE: z.coerce.number().int().min(8000).max(48000).default(24000),
  DOUBAO_OUTPUT_AUDIO_FORMAT: z.enum(["pcm", "pcm_s16le"]).default("pcm"),
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
  doubaoRealtimeBaseUrl: string;
  doubaoAppId: string;
  doubaoAccessKey: string;
  doubaoResourceId: string;
  doubaoAppKey: string;
  doubaoBotName: string;
  doubaoSpeaker: string;
  doubaoRecvTimeout: number;
  doubaoInputMod: "audio" | "text" | "audio_file";
  doubaoInputSampleRate: number;
  doubaoOutputSampleRate: number;
  doubaoOutputAudioFormat: "pcm" | "pcm_s16le";
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
    doubaoRealtimeBaseUrl: parsed.data.DOUBAO_REALTIME_BASE_URL,
    doubaoAppId: parsed.data.DOUBAO_APP_ID,
    doubaoAccessKey: parsed.data.DOUBAO_ACCESS_KEY,
    doubaoResourceId: parsed.data.DOUBAO_RESOURCE_ID,
    doubaoAppKey: parsed.data.DOUBAO_APP_KEY,
    doubaoBotName: parsed.data.DOUBAO_BOT_NAME,
    doubaoSpeaker: parsed.data.DOUBAO_SPEAKER,
    doubaoRecvTimeout: parsed.data.DOUBAO_RECV_TIMEOUT,
    doubaoInputMod: parsed.data.DOUBAO_INPUT_MOD,
    doubaoInputSampleRate: parsed.data.DOUBAO_INPUT_SAMPLE_RATE,
    doubaoOutputSampleRate: parsed.data.DOUBAO_OUTPUT_SAMPLE_RATE,
    doubaoOutputAudioFormat: parsed.data.DOUBAO_OUTPUT_AUDIO_FORMAT,
    host: parsed.data.HOST,
    port: parsed.data.PORT,
    saveHistory: parsed.data.SAVE_HISTORY
  };
}
