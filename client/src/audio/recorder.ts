export type RecordedClip = {
  blob: Blob;
  mimeType: string;
  durationMs: number;
};

const SUPPORTED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4"
];

export class PttRecorder {
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mimeType = "audio/webm";
  private startMs = 0;

  public async start(): Promise<void> {
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前浏览器不支持麦克风采集");
    }

    if (!this.stream) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
    }

    this.mimeType = pickMimeType();
    const recorderOptions = this.mimeType ? { mimeType: this.mimeType } : undefined;

    this.chunks = [];
    this.mediaRecorder = new MediaRecorder(this.stream, recorderOptions);

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };

    this.startMs = performance.now();

    await new Promise<void>((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error("Recorder initialization failed"));
        return;
      }

      this.mediaRecorder.onstart = () => resolve();
      this.mediaRecorder.onerror = () => reject(new Error("无法启动录音"));
      this.mediaRecorder.start(120);
    });
  }

  public async stop(): Promise<RecordedClip> {
    if (!this.mediaRecorder || this.mediaRecorder.state !== "recording") {
      return {
        blob: new Blob(),
        mimeType: this.mimeType,
        durationMs: 0
      };
    }

    const recorder = this.mediaRecorder;

    await new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error("录音停止失败"));
      recorder.stop();
    });

    this.mediaRecorder = null;

    const durationMs = Math.max(0, performance.now() - this.startMs);
    const blob = new Blob(this.chunks, {
      type: recorder.mimeType || this.mimeType
    });

    this.chunks = [];

    return {
      blob,
      mimeType: recorder.mimeType || this.mimeType,
      durationMs
    };
  }

  public async dispose(): Promise<void> {
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      await this.stop();
    }

    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
  }
}

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  for (const mimeType of SUPPORTED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return "";
}
