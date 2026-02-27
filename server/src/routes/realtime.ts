import { randomUUID } from "node:crypto";

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type WebSocket from "ws";
import type { RawData } from "ws";

import type { SessionStore } from "../services/historyStore.js";
import {
  MessageType,
  type ParsedDoubaoMessage
} from "../services/doubaoProtocol.js";
import {
  DoubaoRealtimeClient,
  type DoubaoSessionConfig
} from "../services/doubaoRealtimeClient.js";
import { config } from "../services/openaiClient.js";

type RealtimeRoutesOptions = {
  store: SessionStore;
};

type SessionCreateInput = {
  speaker?: string;
  botName?: string;
  systemRole?: string;
  speakingStyle?: string;
  locationCity?: string;
  recvTimeout?: number;
  inputMod?: "audio" | "text" | "audio_file";
};

type GatewaySession = {
  id: string;
  config: SessionCreateInput;
  upstream: DoubaoRealtimeClient | null;
  clientSocket: WebSocket | null;
};

const sessionCreateSchema = z.object({
  speaker: z.string().min(1).optional(),
  botName: z.string().min(1).optional(),
  systemRole: z.string().min(1).optional(),
  speakingStyle: z.string().min(1).optional(),
  locationCity: z.string().min(1).optional(),
  recvTimeout: z.number().int().min(10).max(120).optional(),
  inputMod: z.enum(["audio", "text", "audio_file"]).optional()
});

const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("client.start"),
    hello: z.string().optional()
  }),
  z.object({
    type: z.literal("client.audio.append"),
    audio: z.string().min(1)
  }),
  z.object({
    type: z.literal("client.audio.commit")
  }),
  z.object({
    type: z.literal("client.chat.text"),
    content: z.string().min(1)
  }),
  z.object({
    type: z.literal("client.interrupt")
  }),
  z.object({
    type: z.literal("client.stop")
  })
]);

const interruptSchema = z.object({
  sessionId: z.string().min(1)
});

export const realtimeRoutes: FastifyPluginAsync<RealtimeRoutesOptions> = async (app, options) => {
  const sessions = new Map<string, GatewaySession>();

  app.post<{ Body: SessionCreateInput }>("/api/realtime/session", async (request, reply) => {
    const parsed = sessionCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_session_config",
        message: parsed.error.message
      });
    }

    const sessionId = randomUUID();
    const session: GatewaySession = {
      id: sessionId,
      config: parsed.data,
      upstream: null,
      clientSocket: null
    };

    sessions.set(sessionId, session);
    await options.store.appendEvent(sessionId, "session_opened", {
      source: "api",
      config: parsed.data
    });

    return {
      sessionId,
      wsPath: `/api/realtime/ws?sessionId=${encodeURIComponent(sessionId)}`,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    };
  });

  app.get("/api/realtime/ws", { websocket: true }, async (socket, request) => {
    const query = request.query as Record<string, string | undefined>;
    const sessionId = query.sessionId;

    if (!sessionId) {
      socket.close(1008, "missing_session_id");
      return;
    }

    const session =
      sessions.get(sessionId) ??
      ({
        id: sessionId,
        config: {},
        upstream: null,
        clientSocket: null
      } satisfies GatewaySession);

    sessions.set(sessionId, session);

    if (session.clientSocket && session.clientSocket.readyState === session.clientSocket.OPEN) {
      session.clientSocket.close(4001, "new_client_connected");
    }

    session.clientSocket = socket;

    try {
      await ensureUpstream(session, options.store);
      sendToClient(session, {
        type: "server.ready",
        sessionId,
        outputAudioFormat: config.doubaoOutputAudioFormat
      });
    } catch (error) {
      sendToClient(session, {
        type: "server.error",
        error: "upstream_connect_failed",
        message: error instanceof Error ? error.message : String(error)
      });
      socket.close(1011, "upstream_connect_failed");
      await closeGatewaySession(session, sessions, options.store);
      return;
    }

    socket.on("message", (rawData: RawData) => {
      void handleClientMessage(rawData, session, sessions, options.store).catch(async (error) => {
        request.log.error({ err: error }, "failed to handle realtime client message");
        sendToClient(session, {
          type: "server.error",
          error: "client_message_failed",
          message: error instanceof Error ? error.message : String(error)
        });
      });
    });

    socket.on("close", () => {
      void closeGatewaySession(session, sessions, options.store);
    });
  });

  app.post<{ Body: { sessionId?: string } }>("/api/realtime/interrupt", async (request, reply) => {
    const parsed = interruptSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_session_id" });
    }

    const session = sessions.get(parsed.data.sessionId);
    if (!session || !session.upstream) {
      return { ok: true, interrupted: false };
    }

    await session.upstream.restartSession();
    await options.store.appendEvent(parsed.data.sessionId, "session_interrupted", {
      source: "api"
    });

    sendToClient(session, {
      type: "server.event",
      event: 450,
      payload: {
        source: "interrupt_api"
      }
    });

    return { ok: true, interrupted: true };
  });
};

async function ensureUpstream(session: GatewaySession, store: SessionStore): Promise<void> {
  if (session.upstream) {
    return;
  }

  const upstreamConfig: DoubaoSessionConfig = {
    sessionId: session.id,
    speaker: session.config.speaker,
    botName: session.config.botName,
    systemRole: session.config.systemRole,
    speakingStyle: session.config.speakingStyle,
    locationCity: session.config.locationCity,
    recvTimeout: session.config.recvTimeout,
    inputMod: session.config.inputMod
  };

  const upstream = new DoubaoRealtimeClient(upstreamConfig);
  session.upstream = upstream;

  upstream.on("message", (message) => {
    void handleUpstreamMessage(message, session, store);
  });

  upstream.on("close", (code, reason) => {
    sendToClient(session, {
      type: "server.closed",
      code,
      reason: reason.toString("utf8")
    });
  });

  upstream.on("error", (error) => {
    sendToClient(session, {
      type: "server.error",
      error: "upstream_error",
      message: error.message
    });
  });

  await upstream.connect();
  await store.appendEvent(session.id, "upstream_connected", {});
}

async function handleClientMessage(
  rawData: RawData,
  session: GatewaySession,
  sessions: Map<string, GatewaySession>,
  store: SessionStore
): Promise<void> {
  const text = rawDataToString(rawData);
  let data: unknown;

  try {
    data = JSON.parse(text) as unknown;
  } catch {
    sendToClient(session, {
      type: "server.error",
      error: "invalid_json",
      message: "message must be json"
    });
    return;
  }

  const parsed = clientMessageSchema.safeParse(data);
  if (!parsed.success) {
    sendToClient(session, {
      type: "server.error",
      error: "invalid_message",
      message: parsed.error.message
    });
    return;
  }

  if (!session.upstream) {
    await ensureUpstream(session, store);
  }

  switch (parsed.data.type) {
    case "client.start":
      await store.appendEvent(session.id, "client_started", {});
      if (parsed.data.hello) {
        await session.upstream?.sendHello(parsed.data.hello);
      }
      return;
    case "client.audio.append":
      {
        const audioBuffer = Buffer.from(parsed.data.audio, "base64");
        await session.upstream?.sendAudioChunk(audioBuffer);
        await store.appendEvent(session.id, "input_audio_chunk", {
          bytes: audioBuffer.length
        });
      }
      return;
    case "client.audio.commit":
      for (let i = 0; i < 12; i += 1) {
        await session.upstream?.sendAudioChunk(Buffer.alloc(3200));
      }
      await store.appendEvent(session.id, "input_audio_committed", {});
      return;
    case "client.chat.text":
      await session.upstream?.sendChatText(parsed.data.content);
      await store.appendEvent(session.id, "input_text", {
        content: parsed.data.content
      });
      return;
    case "client.interrupt":
      await session.upstream?.restartSession();
      await store.appendEvent(session.id, "session_interrupted", {
        source: "client"
      });
      sendToClient(session, {
        type: "server.event",
        event: 450,
        payload: {
          source: "client_interrupt"
        }
      });
      return;
    case "client.stop":
      await closeGatewaySession(session, sessions, store);
      return;
    default:
      return;
  }
}

async function handleUpstreamMessage(
  message: ParsedDoubaoMessage,
  session: GatewaySession,
  store: SessionStore
): Promise<void> {
  if (message.messageType === MessageType.SERVER_ACK && Buffer.isBuffer(message.payload)) {
    sendToClient(session, {
      type: "server.tts.audio",
      audio: message.payload.toString("base64"),
      event: message.event ?? null
    });

    await store.appendEvent(session.id, "assistant_audio_chunk", {
      event: message.event ?? null,
      bytes: message.payload.length
    });

    return;
  }

  if (message.messageType === MessageType.SERVER_ERROR_RESPONSE) {
    const mappedMessage = mapUpstreamErrorMessage(message.code, message.payload);
    sendToClient(session, {
      type: "server.error",
      error: "upstream_server_error",
      code: message.code ?? 0,
      message: mappedMessage,
      payload: message.payload
    });
    await store.appendEvent(session.id, "error", {
      code: message.code ?? 0,
      payload: message.payload
    });
    return;
  }

  sendToClient(session, {
    type: "server.event",
    event: message.event ?? null,
    payload: message.payload
  });

  const extractedText = extractText(message.payload);
  if (extractedText) {
    sendToClient(session, {
      type: "server.text",
      role: inferTextRole(message.event ?? 0, message.payload),
      text: extractedText
    });
  }

  await store.appendEvent(session.id, "upstream_event", {
    event: message.event ?? null,
    payload: message.payload
  });
}

async function closeGatewaySession(
  session: GatewaySession,
  sessions: Map<string, GatewaySession>,
  store: SessionStore
): Promise<void> {
  if (!sessions.has(session.id) && !session.upstream && !session.clientSocket) {
    return;
  }

  sessions.delete(session.id);

  if (session.clientSocket && session.clientSocket.readyState === session.clientSocket.OPEN) {
    session.clientSocket.close(1000, "session_closed");
  }
  session.clientSocket = null;

  if (session.upstream) {
    await session.upstream.close();
    session.upstream.removeAllListeners();
    session.upstream = null;
  }

  await store.appendEvent(session.id, "session_closed", {});
}

function sendToClient(session: GatewaySession, payload: Record<string, unknown>): void {
  if (!session.clientSocket || session.clientSocket.readyState !== session.clientSocket.OPEN) {
    return;
  }

  session.clientSocket.send(JSON.stringify(payload));
}

function extractText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as Record<string, unknown>;
  const keys = [
    "content",
    "text",
    "sentence",
    "result",
    "display_text",
    "answer",
    "output_text"
  ];

  for (const key of keys) {
    const value = candidate[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function inferTextRole(event: number, payload: unknown): "user" | "assistant" | "system" {
  if (event === 550 || event === 559 || event === 350 || event === 351 || event === 352 || event === 359) {
    return "assistant";
  }

  if (event === 451 || event === 459) {
    return "user";
  }

  if (event >= 450) {
    return "system";
  }

  if (payload && typeof payload === "object") {
    const candidate = payload as Record<string, unknown>;
    if (typeof candidate.tts_type === "string") {
      return "assistant";
    }
    if (candidate.from === "user" || candidate.role === "user") {
      return "user";
    }
    if (candidate.from === "system" || candidate.role === "system") {
      return "system";
    }
  }

  return "assistant";
}

function mapUpstreamErrorMessage(code: number | undefined, payload: unknown): string {
  const errorText = extractUpstreamErrorText(payload);
  if (errorText.includes("session number limit exceeded")) {
    return "上游会话数已达上限，请稍后重试或先关闭其它在线会话。";
  }

  if (errorText.includes("DialogAudioIdleTimeoutError")) {
    return "会话空闲超时，按住继续说话。";
  }

  if (errorText.includes("AudioASRIdleTimeoutError")) {
    return "会话空闲超时，按住继续说话。";
  }

  if (code !== undefined && code > 0) {
    return `上游语音服务错误（code: ${code}）`;
  }

  return "上游语音服务错误";
}

function extractUpstreamErrorText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as Record<string, unknown>;
  const direct = record.error;
  if (typeof direct === "string") {
    return direct;
  }

  const message = record.message;
  if (typeof message === "string") {
    return message;
  }

  return "";
}

function rawDataToString(rawData: RawData): string {
  if (typeof rawData === "string") {
    return rawData;
  }

  if (Buffer.isBuffer(rawData)) {
    return rawData.toString("utf8");
  }

  if (Array.isArray(rawData)) {
    return Buffer.concat(rawData).toString("utf8");
  }

  return Buffer.from(rawData).toString("utf8");
}
