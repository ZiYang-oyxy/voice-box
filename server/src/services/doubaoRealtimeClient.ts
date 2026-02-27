import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

import WebSocket, { type RawData } from "ws";

import {
  createDoubaoFrame,
  MessageCompression,
  MessageSerialization,
  MessageType,
  MessageTypeSpecificFlags,
  parseDoubaoMessage,
  type ParsedDoubaoMessage
} from "./doubaoProtocol.js";
import { config } from "./openaiClient.js";

export type DoubaoSessionConfig = {
  sessionId: string;
  speaker?: string;
  botName?: string;
  systemRole?: string;
  speakingStyle?: string;
  locationCity?: string;
  recvTimeout?: number;
  inputMod?: "audio" | "text" | "audio_file";
};

type DoubaoRealtimeClientEvents = {
  message: [ParsedDoubaoMessage];
  close: [number, Buffer];
  error: [Error];
};

export class DoubaoRealtimeClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private started = false;
  private closed = false;

  public constructor(private readonly session: DoubaoSessionConfig) {
    super();
  }

  public override on<K extends keyof DoubaoRealtimeClientEvents>(
    event: K,
    listener: (...args: DoubaoRealtimeClientEvents[K]) => void
  ): this {
    return super.on(event, listener);
  }

  public override once<K extends keyof DoubaoRealtimeClientEvents>(
    event: K,
    listener: (...args: DoubaoRealtimeClientEvents[K]) => void
  ): this {
    return super.once(event, listener);
  }

  public async connect(): Promise<void> {
    if (this.closed) {
      throw new Error("doubao_client_closed");
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      if (!this.started) {
        await this.startSession();
      }
      return;
    }

    this.ws = await this.openSocket();
    this.bindSocketListeners(this.ws);

    await this.sendStartConnection();
    await this.waitForEvent(50);
    await this.startSession();
    await this.waitForEvent(150);
  }

  public async sendAudioChunk(audio: Buffer): Promise<void> {
    if (audio.length === 0) {
      return;
    }

    await this.sendFrame(
      createDoubaoFrame({
        event: 200,
        sessionId: this.session.sessionId,
        payload: audio,
        messageType: MessageType.CLIENT_AUDIO_ONLY_REQUEST,
        serialization: MessageSerialization.NO_SERIALIZATION,
        compression: MessageCompression.GZIP
      })
    );
  }

  public async sendAudioCommit(): Promise<void> {
    await this.sendFrame(
      createDoubaoFrame({
        sessionId: this.session.sessionId,
        payload: Buffer.alloc(320),
        messageType: MessageType.CLIENT_AUDIO_ONLY_REQUEST,
        // For audio-only request, 0b0010 is "tail packet".
        messageTypeSpecificFlags: MessageTypeSpecificFlags.NEG_SEQUENCE,
        serialization: MessageSerialization.NO_SERIALIZATION,
        compression: MessageCompression.GZIP
      })
    );
  }

  public async sendChatText(content: string): Promise<void> {
    await this.sendFrame(
      createDoubaoFrame({
        event: 501,
        sessionId: this.session.sessionId,
        payload: { content }
      })
    );
  }

  public async sendHello(content: string): Promise<void> {
    await this.sendFrame(
      createDoubaoFrame({
        event: 300,
        sessionId: this.session.sessionId,
        payload: { content }
      })
    );
  }

  public async restartSession(): Promise<void> {
    await this.sendFrame(
      createDoubaoFrame({
        event: 102,
        sessionId: this.session.sessionId,
        payload: {}
      })
    );

    await this.startSession();
    await this.waitForEvent(150);
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;

    try {
      await this.sendFrame(
        createDoubaoFrame({
          event: 102,
          sessionId: this.session.sessionId,
          payload: {}
        })
      );
    } catch {
      // Ignore close-time failures.
    }

    try {
      await this.sendFrame(
        createDoubaoFrame({
          event: 2,
          payload: {}
        })
      );
    } catch {
      // Ignore close-time failures.
    }

    if (this.ws) {
      this.ws.close();
      this.ws.removeAllListeners();
      this.ws = null;
    }
  }

  private async sendStartConnection(): Promise<void> {
    await this.sendFrame(
      createDoubaoFrame({
        event: 1,
        payload: {}
      })
    );
  }

  private async startSession(): Promise<void> {
    const payload = {
      asr: {
        extra: {
          end_smooth_window_ms: 1500
        }
      },
      tts: {
        speaker: this.session.speaker ?? config.doubaoSpeaker,
        audio_config: {
          channel: 1,
          format: config.doubaoOutputAudioFormat,
          sample_rate: config.doubaoOutputSampleRate
        }
      },
      dialog: {
        bot_name: this.session.botName ?? config.doubaoBotName,
        system_role: this.session.systemRole ?? "你是一个高效、简洁、礼貌的语音助手。",
        speaking_style: this.session.speakingStyle ?? "自然、简洁、口语化。",
        ...(this.session.locationCity
          ? {
              location: {
                city: this.session.locationCity
              }
            }
          : {}),
        extra: {
          strict_audit: false,
          recv_timeout: this.session.recvTimeout ?? config.doubaoRecvTimeout,
          input_mod: this.session.inputMod ?? config.doubaoInputMod
        }
      }
    };

    await this.sendFrame(
      createDoubaoFrame({
        event: 100,
        sessionId: this.session.sessionId,
        payload
      })
    );

    this.started = true;
  }

  private async sendFrame(frame: Buffer): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("doubao_ws_not_open");
    }

    await new Promise<void>((resolve, reject) => {
      this.ws?.send(frame, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async openSocket(): Promise<WebSocket> {
    const socket = new WebSocket(config.doubaoRealtimeBaseUrl, {
      headers: {
        "X-Api-App-ID": config.doubaoAppId,
        "X-Api-Access-Key": config.doubaoAccessKey,
        "X-Api-Resource-Id": config.doubaoResourceId,
        "X-Api-App-Key": config.doubaoAppKey,
        "X-Api-Connect-Id": randomUUID()
      },
      perMessageDeflate: false
    });

    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", (error) => reject(error));
    });

    return socket;
  }

  private async waitForEvent(event: number, timeoutMs = 8000): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off("message", onMessage);
        reject(new Error(`doubao_wait_event_timeout_${event}`));
      }, timeoutMs);

      const onMessage = (message: ParsedDoubaoMessage) => {
        if (message.event !== event) {
          return;
        }

        clearTimeout(timer);
        this.off("message", onMessage);
        resolve();
      };

      this.on("message", onMessage);
    });
  }

  private bindSocketListeners(socket: WebSocket): void {
    socket.on("message", (data) => {
      const raw = toBuffer(data);
      const parsed = parseDoubaoMessage(raw);

      if (!parsed) {
        return;
      }

      this.emit("message", parsed);
    });

    socket.on("close", (code, reason) => {
      this.started = false;
      this.emit("close", code, reason);
    });

    socket.on("error", (error) => {
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
    });
  }
}

function toBuffer(raw: RawData): Buffer {
  if (Buffer.isBuffer(raw)) {
    return raw;
  }

  if (typeof raw === "string") {
    return Buffer.from(raw, "utf8");
  }

  if (Array.isArray(raw)) {
    return Buffer.concat(raw);
  }

  return Buffer.from(raw);
}
