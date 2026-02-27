import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { RealtimeAudioPlayer } from "../audio/realtimePlayer";
import { RealtimeRecorder } from "../audio/realtimeRecorder";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

export type VoiceState = "idle" | "connecting" | "recording" | "responding" | "error";

export type TranscriptItem = {
  id: string;
  createdAt: string;
  role: "user" | "assistant" | "system";
  text: string;
};

export type UseRealtimeVoiceResult = {
  state: VoiceState;
  turns: TranscriptItem[];
  error: string | null;
  sessionId: string | null;
  beginPress: () => Promise<void>;
  endPress: () => Promise<void>;
  resetSession: () => Promise<void>;
};

type ServerMessage =
  | { type: "server.ready"; sessionId: string }
  | { type: "server.tts.audio"; audio: string; event?: number | null }
  | { type: "server.text"; role: "user" | "assistant" | "system"; text: string }
  | { type: "server.event"; event: number | null; payload?: unknown }
  | { type: "server.error"; error: string; message?: string; code?: number }
  | { type: "server.closed"; code?: number; reason?: string };

type SessionBootstrap = {
  sessionId: string;
  wsPath: string;
};

export function useRealtimeVoice(): UseRealtimeVoiceResult {
  const recorderRef = useRef<RealtimeRecorder>();
  const playerRef = useRef<RealtimeAudioPlayer>();
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const wsPathRef = useRef<string | null>(null);
  const pressingRef = useRef(false);
  const stateRef = useRef<VoiceState>("idle");
  const resettingRef = useRef(false);

  const [state, setState] = useState<VoiceState>("idle");
  const [turns, setTurns] = useState<TranscriptItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  if (!recorderRef.current) {
    recorderRef.current = new RealtimeRecorder();
  }

  if (!playerRef.current) {
    playerRef.current = new RealtimeAudioPlayer();
  }

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const appendTranscript = useCallback((role: TranscriptItem["role"], text: string) => {
    const normalized = text.trim();
    if (!normalized) {
      return;
    }

    setTurns((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        role,
        text: normalized
      }
    ]);
  }, []);

  const sendToWs = useCallback((payload: Record<string, unknown>) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    wsRef.current.send(JSON.stringify(payload));
  }, []);

  const handleServerMessage = useCallback(
    async (message: ServerMessage) => {
      switch (message.type) {
        case "server.ready":
          if (stateRef.current === "connecting") {
            setState("idle");
          }
          return;
        case "server.tts.audio":
          setState("responding");
          await playerRef.current?.playBase64Pcm(message.audio);
          return;
        case "server.text":
          appendTranscript(message.role, message.text);
          return;
        case "server.event":
          if (message.event === 450) {
            await playerRef.current?.stop();
          }

          if (message.event === 359 && !pressingRef.current) {
            setState("idle");
          }

          {
            const text = extractTextFromPayload(message.payload);
            if (text) {
              appendTranscript(inferRoleFromEvent(message.event), text);
            }
          }
          return;
        case "server.error":
          setState("error");
          setError(message.message ?? message.error);
          appendTranscript("system", `错误: ${message.message ?? message.error}`);
          return;
        case "server.closed":
          if (!resettingRef.current) {
            setState("idle");
          }
          return;
        default:
          return;
      }
    },
    [appendTranscript]
  );

  const connectIfNeeded = useCallback(async (): Promise<void> => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return;
    }

    setState("connecting");

    if (!sessionIdRef.current || !wsPathRef.current) {
      const response = await fetch(`${API_BASE}/api/realtime/session`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({})
      });

      if (!response.ok) {
        throw new Error(`创建实时会话失败 (${response.status})`);
      }

      const data = (await response.json()) as SessionBootstrap;
      sessionIdRef.current = data.sessionId;
      wsPathRef.current = data.wsPath;
      setSessionId(data.sessionId);
    }

    const wsUrl = buildWsUrl(wsPathRef.current);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data)) as ServerMessage;
        void handleServerMessage(data);
      } catch {
        // Ignore malformed message frames.
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    await new Promise<void>((resolve, reject) => {
      const handleOpen = () => {
        ws.removeEventListener("error", handleError);
        resolve();
      };

      const handleError = () => {
        ws.removeEventListener("open", handleOpen);
        reject(new Error("realtime_ws_connect_failed"));
      };

      ws.addEventListener("open", handleOpen, { once: true });
      ws.addEventListener("error", handleError, { once: true });
    });

    ws.onerror = () => {
      setState("error");
      setError("实时连接失败");
    };

    sendToWs({ type: "client.start" });
    setState("idle");
  }, [handleServerMessage, sendToWs]);

  const interrupt = useCallback(async () => {
    sendToWs({ type: "client.interrupt" });

    if (sessionIdRef.current) {
      void fetch(`${API_BASE}/api/realtime/interrupt`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ sessionId: sessionIdRef.current })
      }).catch(() => undefined);
    }

    await playerRef.current?.stop();
    appendTranscript("system", "已打断当前播报");
  }, [appendTranscript, sendToWs]);

  const beginPress = useCallback(async () => {
    if (pressingRef.current) {
      return;
    }
    pressingRef.current = true;

    try {
      setError(null);
      await connectIfNeeded();

      if (stateRef.current === "responding") {
        await interrupt();
      }

      await recorderRef.current?.start((chunk) => {
        sendToWs({
          type: "client.audio.append",
          audio: toBase64(chunk)
        });
      });

      setState("recording");
    } catch (cause) {
      pressingRef.current = false;
      setState("error");
      setError(toErrorMessage(cause, "无法启动实时录音"));
    }
  }, [connectIfNeeded, interrupt, sendToWs]);

  const endPress = useCallback(async () => {
    if (!pressingRef.current) {
      return;
    }
    pressingRef.current = false;

    if (stateRef.current !== "recording") {
      return;
    }

    try {
      await recorderRef.current?.stop();
      sendToWs({ type: "client.audio.commit" });
      setState("responding");
    } catch (cause) {
      setState("error");
      setError(toErrorMessage(cause, "结束录音失败"));
    }
  }, [sendToWs]);

  const resetSession = useCallback(async () => {
    resettingRef.current = true;

    pressingRef.current = false;
    setState("idle");
    setError(null);
    setTurns([]);

    sendToWs({ type: "client.stop" });

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    sessionIdRef.current = null;
    wsPathRef.current = null;
    setSessionId(null);

    await recorderRef.current?.dispose();
    await playerRef.current?.dispose();

    resettingRef.current = false;
  }, [sendToWs]);

  useEffect(() => {
    return () => {
      void resetSession();
    };
  }, [resetSession]);

  return useMemo(
    () => ({
      state,
      turns,
      error,
      sessionId,
      beginPress,
      endPress,
      resetSession
    }),
    [state, turns, error, sessionId, beginPress, endPress, resetSession]
  );
}

function buildWsUrl(path: string | null): string {
  if (!path) {
    throw new Error("realtime_ws_path_missing");
  }

  if (path.startsWith("ws://") || path.startsWith("wss://")) {
    return path;
  }

  const base = API_BASE.replace(/^http/, "ws");
  return `${base}${path}`;
}

function toBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }

  return btoa(binary);
}

function extractTextFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as Record<string, unknown>;
  const keys = ["content", "text", "sentence", "result", "answer", "output_text", "display_text"];

  for (const key of keys) {
    const value = candidate[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function inferRoleFromEvent(event: number | null): "user" | "assistant" | "system" {
  if (event === null) {
    return "system";
  }

  if (event >= 450) {
    return "system";
  }

  return "assistant";
}

function toErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message) {
    return cause.message;
  }

  return fallback;
}
