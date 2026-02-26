import { config, openai } from "./openaiClient.js";

type CreateSpeechStreamParams = {
  text: string;
  voice: string;
  signal: AbortSignal;
};

export async function createSpeechStream({
  text,
  voice,
  signal
}: CreateSpeechStreamParams): Promise<{ body: ReadableStream<Uint8Array>; contentType: string }> {
  const rawResponse = await openai.audio.speech.create(
    {
      model: config.ttsModel,
      voice,
      input: text,
      response_format: "mp3"
    },
    { signal }
  );

  const response = rawResponse as unknown as Response;

  if (!response.body) {
    throw new Error("TTS stream is empty");
  }

  return {
    body: response.body,
    contentType: response.headers.get("content-type") ?? "audio/mpeg"
  };
}
