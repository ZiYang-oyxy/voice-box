import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";

import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";

import type { SessionStore } from "../services/historyStore.js";
import { generateAssistantResponse } from "../services/llm.js";
import { config } from "../services/openaiClient.js";
import { transcribeAudio } from "../services/stt.js";
import { createSpeechStream } from "../services/tts.js";
import type { LanguageHint } from "../types.js";

type VoiceRoutesOptions = {
  store: SessionStore;
};

type TurnInput = {
  audio: Buffer;
  mimeType: string;
  sessionId?: string;
  voice?: string;
  languageHint: LanguageHint;
};

const interruptSchema = z.object({
  sessionId: z.string().min(1)
});

export const voiceRoutes: FastifyPluginAsync<VoiceRoutesOptions> = async (app, options) => {
  const inFlightTurns = new Map<string, AbortController>();

  app.post("/api/voice/turn", async (request, reply) => {
    let sessionId = "";
    let turnId = randomUUID();

    try {
      const input = await readTurnInput(request);
      sessionId = input.sessionId ?? randomUUID();

      const active = inFlightTurns.get(sessionId);
      if (active) {
        active.abort();
        inFlightTurns.delete(sessionId);
      }

      const abortController = new AbortController();
      inFlightTurns.set(sessionId, abortController);

      const startedAt = Date.now();
      await options.store.appendEvent(sessionId, "turn_started", {
        turnId,
        mimeType: input.mimeType,
        languageHint: input.languageHint
      });

      const userText = await transcribeAudio({
        audio: input.audio,
        mimeType: input.mimeType,
        languageHint: input.languageHint,
        signal: abortController.signal
      });

      await options.store.appendEvent(sessionId, "turn_transcribed", {
        turnId,
        userText
      });

      const conversation = await options.store.getConversationMessages(sessionId);
      const assistantText = await generateAssistantResponse({
        conversation,
        userText,
        languageHint: input.languageHint,
        signal: abortController.signal
      });

      const tts = await createSpeechStream({
        text: assistantText,
        voice: input.voice ?? config.defaultVoice,
        signal: abortController.signal
      });

      const elapsedMs = Date.now() - startedAt;
      await options.store.appendEvent(sessionId, "turn_completed", {
        turnId,
        userText,
        assistantText,
        elapsedMs,
        sttModel: config.sttModel,
        llmModel: config.llmModel,
        ttsModel: config.ttsModel
      });

      const audioStream = Readable.fromWeb(tts.body as never);
      audioStream.once("close", () => {
        cleanupInFlightTurn(sessionId, abortController, inFlightTurns);
      });
      audioStream.once("error", () => {
        cleanupInFlightTurn(sessionId, abortController, inFlightTurns);
      });

      reply.header("cache-control", "no-store");
      reply.header("x-session-id", sessionId);
      reply.header("x-user-text", headerSafeText(userText, 500));
      reply.header("x-assistant-text", headerSafeText(assistantText, 2000));
      reply.type(tts.contentType);

      return reply.send(audioStream);
    } catch (error) {
      if (error instanceof Error && error.message === "audio field is required") {
        return reply.code(400).send({
          error: "audio_required",
          message: "multipart field `audio` is required"
        });
      }

      const aborted = isAbortError(error);

      if (sessionId) {
        await options.store.appendEvent(sessionId, aborted ? "turn_aborted" : "turn_error", {
          turnId,
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }

      if (aborted) {
        return reply.code(409).send({
          error: "turn_interrupted",
          sessionId
        });
      }

      request.log.error({ err: error }, "Failed to process voice turn");
      return reply.code(500).send({
        error: "voice_turn_failed",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    } finally {
      const active = sessionId ? inFlightTurns.get(sessionId) : undefined;
      if (active?.signal.aborted) {
        inFlightTurns.delete(sessionId);
      }
    }
  });

  app.post<{ Body: { sessionId?: string } }>("/api/voice/interrupt", async (request, reply) => {
    const parsed = interruptSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_session_id" });
    }

    const controller = inFlightTurns.get(parsed.data.sessionId);
    if (!controller) {
      return { ok: true, interrupted: false };
    }

    controller.abort();
    inFlightTurns.delete(parsed.data.sessionId);

    await options.store.appendEvent(parsed.data.sessionId, "turn_interrupted", {
      reason: "user"
    });

    return { ok: true, interrupted: true };
  });
};

async function readTurnInput(request: FastifyRequest): Promise<TurnInput> {
  const parts = request.parts();

  let audio: Buffer | null = null;
  let mimeType = "audio/webm";
  const fields: Record<string, string> = {};

  for await (const part of parts) {
    if (part.type === "file") {
      const buffer = await part.toBuffer();
      if (part.fieldname === "audio") {
        audio = buffer;
        mimeType = part.mimetype || mimeType;
      }
      continue;
    }

    fields[part.fieldname] = String(part.value ?? "").trim();
  }

  if (!audio) {
    throw new Error("audio field is required");
  }

  return {
    audio,
    mimeType,
    sessionId: fields.sessionId || undefined,
    voice: fields.voice || undefined,
    languageHint: parseLanguageHint(fields.languageHint)
  };
}

function parseLanguageHint(value?: string): LanguageHint {
  if (value === "zh" || value === "en") {
    return value;
  }

  return "auto";
}

function headerSafeText(text: string, maxLength: number): string {
  return encodeURIComponent(text.slice(0, maxLength));
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")
  );
}

function cleanupInFlightTurn(
  sessionId: string,
  abortController: AbortController,
  inFlightTurns: Map<string, AbortController>
): void {
  const active = inFlightTurns.get(sessionId);
  if (active === abortController) {
    inFlightTurns.delete(sessionId);
  }
}
