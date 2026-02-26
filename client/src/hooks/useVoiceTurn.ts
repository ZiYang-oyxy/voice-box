import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { StreamAudioPlayer } from "../audio/player";
import { PttRecorder } from "../audio/recorder";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

export type VoiceState = "idle" | "recording" | "uploading" | "thinking" | "speaking" | "error";

export type TurnRecord = {
  id: string;
  createdAt: string;
  userText: string;
  assistantText: string;
};

export type UseVoiceTurnResult = {
  state: VoiceState;
  turns: TurnRecord[];
  error: string | null;
  sessionId: string | null;
  beginPress: () => Promise<void>;
  endPress: () => Promise<void>;
  resetSession: () => void;
};

export function useVoiceTurn(): UseVoiceTurnResult {
  const recorderRef = useRef<PttRecorder>();
  const playerRef = useRef<StreamAudioPlayer>();
  const turnAbortRef = useRef<AbortController | null>(null);
  const pressingRef = useRef(false);
  const stateRef = useRef<VoiceState>("idle");
  const sessionIdRef = useRef<string | null>(null);

  const [state, setState] = useState<VoiceState>("idle");
  const [turns, setTurns] = useState<TurnRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  if (!recorderRef.current) {
    recorderRef.current = new PttRecorder();
  }

  if (!playerRef.current) {
    playerRef.current = new StreamAudioPlayer();
  }

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const interruptActiveTurn = useCallback(async () => {
    if (turnAbortRef.current) {
      turnAbortRef.current.abort();
      turnAbortRef.current = null;
    }

    if (sessionIdRef.current) {
      void fetch(`${API_BASE}/api/voice/interrupt`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ sessionId: sessionIdRef.current })
      }).catch(() => undefined);
    }

    if (playerRef.current) {
      await playerRef.current.stop();
    }

    setState("idle");
  }, []);

  const beginPress = useCallback(async () => {
    if (pressingRef.current) {
      return;
    }

    pressingRef.current = true;

    try {
      setError(null);

      if (
        stateRef.current === "uploading" ||
        stateRef.current === "thinking" ||
        stateRef.current === "speaking"
      ) {
        await interruptActiveTurn();
      }

      await recorderRef.current?.start();
      setState("recording");
    } catch (cause) {
      pressingRef.current = false;
      setState("error");
      setError(toErrorMessage(cause, "无法启动录音，请检查麦克风权限"));
    }
  }, [interruptActiveTurn]);

  const endPress = useCallback(async () => {
    if (!pressingRef.current) {
      return;
    }

    pressingRef.current = false;

    if (stateRef.current !== "recording") {
      return;
    }

    try {
      const clip = await recorderRef.current?.stop();

      if (!clip || clip.blob.size === 0) {
        setState("idle");
        return;
      }

      setState("uploading");
      const turnController = new AbortController();
      turnAbortRef.current = turnController;

      const formData = new FormData();
      formData.set("audio", clip.blob, `turn.${extensionFromMime(clip.mimeType)}`);
      formData.set("languageHint", "auto");
      if (sessionIdRef.current) {
        formData.set("sessionId", sessionIdRef.current);
      }

      const response = await fetch(`${API_BASE}/api/voice/turn`, {
        method: "POST",
        body: formData,
        signal: turnController.signal
      });

      if (!response.ok) {
        throw new Error(await getErrorResponseMessage(response));
      }

      const responseSessionId = response.headers.get("x-session-id");
      if (responseSessionId) {
        setSessionId(responseSessionId);
      }

      const userText = decodeHeaderText(response.headers.get("x-user-text"));
      const assistantText = decodeHeaderText(response.headers.get("x-assistant-text"));

      if (userText || assistantText) {
        setTurns((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            userText: userText || "(无有效转写)",
            assistantText: assistantText || "(无回复内容)"
          }
        ]);
      }

      setState("thinking");
      setState("speaking");

      await playerRef.current?.playResponse(response, turnController.signal);
      setState("idle");
    } catch (cause) {
      if (isAbortError(cause)) {
        setState("idle");
        return;
      }

      setState("error");
      setError(toErrorMessage(cause, "语音请求失败"));
    } finally {
      turnAbortRef.current = null;
    }
  }, []);

  const resetSession = useCallback(() => {
    setSessionId(null);
    setTurns([]);
    setError(null);
    setState("idle");
  }, []);

  useEffect(() => {
    return () => {
      turnAbortRef.current?.abort();
      void recorderRef.current?.dispose();
      void playerRef.current?.dispose();
    };
  }, []);

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

function decodeHeaderText(value: string | null): string {
  if (!value) {
    return "";
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extensionFromMime(mimeType: string): string {
  if (mimeType.includes("ogg")) {
    return "ogg";
  }
  if (mimeType.includes("mp4")) {
    return "mp4";
  }
  if (mimeType.includes("wav")) {
    return "wav";
  }
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) {
    return "mp3";
  }
  return "webm";
}

async function getErrorResponseMessage(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const data = (await response.json()) as { error?: string; message?: string };
      return data.message ?? data.error ?? `请求失败 (${response.status})`;
    } catch {
      return `请求失败 (${response.status})`;
    }
  }

  try {
    const rawText = await response.text();
    return rawText || `请求失败 (${response.status})`;
  } catch {
    return `请求失败 (${response.status})`;
  }
}

function toErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message;
  }

  return fallback;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")
  );
}
