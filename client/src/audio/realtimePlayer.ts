const DEFAULT_OUTPUT_SAMPLE_RATE = 24000;

export class RealtimeAudioPlayer {
  private context: AudioContext | null = null;
  private nextPlayTime = 0;
  private readonly outputSampleRate: number;

  public constructor(outputSampleRate = DEFAULT_OUTPUT_SAMPLE_RATE) {
    this.outputSampleRate = outputSampleRate;
  }

  public async playBase64Pcm(base64Pcm: string): Promise<void> {
    if (!base64Pcm) {
      return;
    }

    const context = await this.ensureContext();
    const pcmBytes = decodeBase64(base64Pcm);
    const floatData = int16BytesToFloat32(pcmBytes);

    const audioBuffer = context.createBuffer(1, floatData.length, this.outputSampleRate);
    audioBuffer.getChannelData(0).set(floatData);

    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);

    const startAt = Math.max(context.currentTime + 0.02, this.nextPlayTime);
    source.start(startAt);
    this.nextPlayTime = startAt + audioBuffer.duration;
  }

  public async stop(): Promise<void> {
    this.nextPlayTime = 0;

    if (this.context) {
      await this.context.close();
      this.context = null;
    }
  }

  public async dispose(): Promise<void> {
    await this.stop();
  }

  private async ensureContext(): Promise<AudioContext> {
    if (!this.context) {
      this.context = new AudioContext();
    }

    if (this.context.state !== "running") {
      await this.context.resume();
    }

    return this.context;
  }
}

function decodeBase64(base64Text: string): Uint8Array {
  const binary = atob(base64Text);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function int16BytesToFloat32(pcmBytes: Uint8Array): Float32Array {
  const sampleCount = Math.floor(pcmBytes.byteLength / 2);
  const output = new Float32Array(sampleCount);
  const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);

  for (let i = 0; i < sampleCount; i += 1) {
    const value = view.getInt16(i * 2, true);
    output[i] = value / 32768;
  }

  return output;
}
