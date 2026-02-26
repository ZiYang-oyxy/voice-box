import { toFile } from "openai/uploads";

import type { LanguageHint } from "../types.js";
import { config, openai } from "./openaiClient.js";

type TranscribeParams = {
  audio: Buffer;
  mimeType: string;
  languageHint: LanguageHint;
  signal: AbortSignal;
};

const MIME_TO_EXTENSION: Record<string, string> = {
  "audio/webm": "webm",
  "audio/webm;codecs=opus": "webm",
  "audio/ogg": "ogg",
  "audio/ogg;codecs=opus": "ogg",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav"
};

export async function transcribeAudio({
  audio,
  mimeType,
  languageHint,
  signal
}: TranscribeParams): Promise<string> {
  const extension = MIME_TO_EXTENSION[mimeType] ?? "webm";
  const file = await toFile(audio, `turn.${extension}`, {
    type: mimeType || "audio/webm"
  });

  const response = await openai.audio.transcriptions.create(
    {
      model: config.sttModel,
      file,
      ...(languageHint === "auto" ? {} : { language: languageHint })
    },
    { signal }
  );

  const text = response.text?.trim() ?? "";
  if (!text) {
    throw new Error("STT returned empty text");
  }

  return text;
}
