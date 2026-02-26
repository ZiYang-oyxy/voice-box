const MEDIA_SOURCE_MIME = "audio/mpeg";

export class StreamAudioPlayer {
  private readonly audioElement: HTMLAudioElement;
  private objectUrl: string | null = null;
  private activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  public constructor() {
    this.audioElement = document.createElement("audio");
    this.audioElement.autoplay = true;
    this.audioElement.preload = "auto";
    this.audioElement.style.display = "none";
    document.body.appendChild(this.audioElement);
  }

  public async playResponse(response: Response, signal?: AbortSignal): Promise<void> {
    if (!response.body) {
      throw new Error("服务端未返回音频流");
    }

    await this.stop();

    const canUseMediaSource =
      typeof window !== "undefined" &&
      "MediaSource" in window &&
      MediaSource.isTypeSupported(MEDIA_SOURCE_MIME) &&
      (response.headers.get("content-type") ?? "").includes("audio");

    if (!canUseMediaSource) {
      await this.playFallback(response, signal);
      return;
    }

    await this.playWithMediaSource(response, signal);
  }

  public async stop(): Promise<void> {
    if (this.activeReader) {
      try {
        await this.activeReader.cancel();
      } catch {
        // Ignore stream cancellation errors.
      }
      this.activeReader = null;
    }

    this.audioElement.pause();
    this.audioElement.removeAttribute("src");
    this.audioElement.load();

    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  public async dispose(): Promise<void> {
    await this.stop();
    this.audioElement.remove();
  }

  private async playWithMediaSource(response: Response, signal?: AbortSignal): Promise<void> {
    const mediaSource = new MediaSource();
    this.objectUrl = URL.createObjectURL(mediaSource);
    this.audioElement.src = this.objectUrl;

    const sourceOpenPromise = waitForSourceOpen(mediaSource);

    await safePlay(this.audioElement);
    await sourceOpenPromise;

    const sourceBuffer = mediaSource.addSourceBuffer(MEDIA_SOURCE_MIME);
    sourceBuffer.mode = "sequence";

    const pendingChunks: Uint8Array[] = [];
    let streamEnded = false;
    let appending = false;

    const tryAppend = () => {
      if (appending || sourceBuffer.updating || pendingChunks.length === 0) {
        if (streamEnded && pendingChunks.length === 0 && !sourceBuffer.updating) {
          try {
            if (mediaSource.readyState === "open") {
              mediaSource.endOfStream();
            }
          } catch {
            // Ignore end-of-stream race conditions.
          }
        }
        return;
      }

      appending = true;
      const chunk = pendingChunks.shift();
      if (!chunk) {
        appending = false;
        return;
      }

      const copy = new Uint8Array(chunk.byteLength);
      copy.set(chunk);
      sourceBuffer.appendBuffer(copy.buffer);
    };

    sourceBuffer.addEventListener("updateend", () => {
      appending = false;
      tryAppend();
    });

    const body = response.body;
    if (!body) {
      throw new Error("服务端未返回音频流");
    }

    const reader = body.getReader();
    this.activeReader = reader;

    while (true) {
      if (signal?.aborted) {
        throw abortError();
      }

      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      if (value && value.byteLength > 0) {
        pendingChunks.push(value);
        tryAppend();
      }
    }

    streamEnded = true;
    tryAppend();

    await waitForAudioEnd(this.audioElement, signal);
    this.activeReader = null;
  }

  private async playFallback(response: Response, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw abortError();
    }

    const audioBytes = await response.arrayBuffer();

    if (signal?.aborted) {
      throw abortError();
    }

    const blob = new Blob([audioBytes], { type: "audio/mpeg" });
    this.objectUrl = URL.createObjectURL(blob);
    this.audioElement.src = this.objectUrl;

    await safePlay(this.audioElement);
    await waitForAudioEnd(this.audioElement, signal);
  }
}

async function safePlay(audioElement: HTMLAudioElement): Promise<void> {
  try {
    await audioElement.play();
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : "浏览器拦截了音频自动播放，请检查浏览器音频权限"
    );
  }
}

async function waitForSourceOpen(mediaSource: MediaSource): Promise<void> {
  if (mediaSource.readyState === "open") {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onSourceOpen = () => {
      cleanup();
      resolve();
    };

    const onSourceClose = () => {
      cleanup();
      reject(new Error("Audio source closed before opening"));
    };

    const cleanup = () => {
      mediaSource.removeEventListener("sourceopen", onSourceOpen);
      mediaSource.removeEventListener("sourceclose", onSourceClose);
    };

    mediaSource.addEventListener("sourceopen", onSourceOpen, { once: true });
    mediaSource.addEventListener("sourceclose", onSourceClose, { once: true });
  });
}

async function waitForAudioEnd(audioElement: HTMLAudioElement, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw abortError();
  }

  await new Promise<void>((resolve, reject) => {
    const onEnded = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("音频播放失败"));
    };

    const onAbort = () => {
      cleanup();
      reject(abortError());
    };

    const cleanup = () => {
      audioElement.removeEventListener("ended", onEnded);
      audioElement.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };

    audioElement.addEventListener("ended", onEnded, { once: true });
    audioElement.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(): Error {
  try {
    return new DOMException("Playback interrupted", "AbortError");
  } catch {
    const error = new Error("Playback interrupted");
    error.name = "AbortError";
    return error;
  }
}
