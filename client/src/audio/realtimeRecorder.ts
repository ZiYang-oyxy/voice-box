export type AudioChunkHandler = (chunk: Uint8Array) => void;

const TARGET_SAMPLE_RATE = 16000;

export class RealtimeRecorder {
  private context: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private running = false;

  public async start(onChunk: AudioChunkHandler): Promise<void> {
    if (this.running) {
      return;
    }

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        noiseSuppression: true,
        echoCancellation: true
      }
    });

    this.context = new AudioContext();
    await this.context.resume();

    this.sourceNode = this.context.createMediaStreamSource(this.mediaStream);
    this.processorNode = this.context.createScriptProcessor(4096, 1, 1);

    this.processorNode.onaudioprocess = (event) => {
      if (!this.running || !this.context) {
        return;
      }

      const input = event.inputBuffer.getChannelData(0);
      const downsampled = downsample(input, this.context.sampleRate, TARGET_SAMPLE_RATE);
      const pcm = floatToInt16(downsampled);

      onChunk(new Uint8Array(pcm.buffer.slice(0)));
    };

    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.context.destination);

    this.running = true;
  }

  public async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;

    if (this.processorNode) {
      this.processorNode.onaudioprocess = null;
      this.processorNode.disconnect();
      this.processorNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }

    if (this.context) {
      await this.context.close();
      this.context = null;
    }
  }

  public async dispose(): Promise<void> {
    await this.stop();
  }
}

function downsample(input: Float32Array, inputRate: number, targetRate: number): Float32Array {
  if (targetRate === inputRate) {
    return input;
  }

  const ratio = inputRate / targetRate;
  const newLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(newLength);

  let outputOffset = 0;
  let inputOffset = 0;

  while (outputOffset < newLength) {
    const nextInputOffset = Math.round((outputOffset + 1) * ratio);
    let sum = 0;
    let count = 0;

    for (let i = inputOffset; i < nextInputOffset && i < input.length; i += 1) {
      sum += input[i];
      count += 1;
    }

    output[outputOffset] = count > 0 ? sum / count : 0;
    outputOffset += 1;
    inputOffset = nextInputOffset;
  }

  return output;
}

function floatToInt16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);

  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return output;
}
