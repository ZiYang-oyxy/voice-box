import { gunzipSync, gzipSync } from "node:zlib";

export const PROTOCOL_VERSION = 0b0001;

export const enum MessageType {
  CLIENT_FULL_REQUEST = 0b0001,
  CLIENT_AUDIO_ONLY_REQUEST = 0b0010,
  SERVER_FULL_RESPONSE = 0b1001,
  SERVER_ACK = 0b1011,
  SERVER_ERROR_RESPONSE = 0b1111
}

export const enum MessageTypeSpecificFlags {
  NO_SEQUENCE = 0b0000,
  POS_SEQUENCE = 0b0001,
  NEG_SEQUENCE = 0b0010,
  NEG_SEQUENCE_1 = 0b0011,
  MSG_WITH_EVENT = 0b0100
}

export const enum MessageSerialization {
  NO_SERIALIZATION = 0b0000,
  JSON = 0b0001,
  THRIFT = 0b0011,
  CUSTOM_TYPE = 0b1111
}

export const enum MessageCompression {
  NO_COMPRESSION = 0b0000,
  GZIP = 0b0001,
  CUSTOM_COMPRESSION = 0b1111
}

type CreateFrameInput = {
  event: number;
  sessionId?: string;
  payload?: unknown;
  messageType?: MessageType;
  messageTypeSpecificFlags?: MessageTypeSpecificFlags;
  serialization?: MessageSerialization;
  compression?: MessageCompression;
};

export type ParsedDoubaoMessage = {
  protocolVersion: number;
  headerSize: number;
  messageType: number;
  messageTypeSpecificFlags: number;
  serialization: number;
  compression: number;
  event?: number;
  sequence?: number;
  sessionId?: string;
  code?: number;
  payloadSize: number;
  payload: unknown;
  payloadBytes: Buffer<ArrayBufferLike>;
};

export function createDoubaoFrame({
  event,
  sessionId,
  payload = {},
  messageType = MessageType.CLIENT_FULL_REQUEST,
  messageTypeSpecificFlags = MessageTypeSpecificFlags.MSG_WITH_EVENT,
  serialization = MessageSerialization.JSON,
  compression = MessageCompression.GZIP
}: CreateFrameInput): Buffer {
  const header = generateHeader({
    messageType,
    messageTypeSpecificFlags,
    serialization,
    compression
  });

  const eventBuffer = allocUint32(event);
  const payloadBytes = encodePayload(payload, serialization, compression);
  const payloadLengthBuffer = allocUint32(payloadBytes.length);

  if (sessionId === undefined) {
    return Buffer.concat([header, eventBuffer, payloadLengthBuffer, payloadBytes]);
  }

  const sessionIdBuffer = Buffer.from(sessionId, "utf8");
  const sessionSizeBuffer = allocInt32(sessionIdBuffer.length);

  return Buffer.concat([
    header,
    eventBuffer,
    sessionSizeBuffer,
    sessionIdBuffer,
    payloadLengthBuffer,
    payloadBytes
  ]);
}

export function parseDoubaoMessage(raw: Buffer | string): ParsedDoubaoMessage | null {
  if (typeof raw === "string") {
    return null;
  }

  if (raw.length < 4) {
    return null;
  }

  const protocolVersion = raw[0] >> 4;
  const headerSize = raw[0] & 0x0f;
  const messageType = raw[1] >> 4;
  const messageTypeSpecificFlags = raw[1] & 0x0f;
  const serialization = raw[2] >> 4;
  const compression = raw[2] & 0x0f;

  if (raw.length < headerSize * 4) {
    return null;
  }

  let payloadView = raw.subarray(headerSize * 4);

  let event: number | undefined;
  let sequence: number | undefined;
  let sessionId: string | undefined;
  let code: number | undefined;
  let payloadSize = 0;
  let payloadBytes: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  if (messageType === MessageType.SERVER_FULL_RESPONSE || messageType === MessageType.SERVER_ACK) {
    let offset = 0;

    if ((messageTypeSpecificFlags & MessageTypeSpecificFlags.NEG_SEQUENCE) > 0) {
      if (payloadView.length < offset + 4) {
        return null;
      }
      sequence = payloadView.readUInt32BE(offset);
      offset += 4;
    }

    if ((messageTypeSpecificFlags & MessageTypeSpecificFlags.MSG_WITH_EVENT) > 0) {
      if (payloadView.length < offset + 4) {
        return null;
      }
      event = payloadView.readUInt32BE(offset);
      offset += 4;
    }

    payloadView = payloadView.subarray(offset);

    if (payloadView.length < 4) {
      return null;
    }

    const sessionIdSize = payloadView.readInt32BE(0);
    if (sessionIdSize < 0 || payloadView.length < 4 + sessionIdSize + 4) {
      return null;
    }

    sessionId = payloadView.subarray(4, 4 + sessionIdSize).toString("utf8");
    payloadView = payloadView.subarray(4 + sessionIdSize);

    payloadSize = payloadView.readUInt32BE(0);
    payloadBytes = payloadView.subarray(4, 4 + payloadSize);
  } else if (messageType === MessageType.SERVER_ERROR_RESPONSE) {
    if (payloadView.length < 8) {
      return null;
    }

    code = payloadView.readUInt32BE(0);
    payloadSize = payloadView.readUInt32BE(4);
    payloadBytes = payloadView.subarray(8, 8 + payloadSize);
  } else {
    return null;
  }

  const payload = decodePayload(payloadBytes, serialization, compression);

  return {
    protocolVersion,
    headerSize,
    messageType,
    messageTypeSpecificFlags,
    serialization,
    compression,
    event,
    sequence,
    sessionId,
    code,
    payloadSize,
    payload,
    payloadBytes
  };
}

function generateHeader({
  messageType,
  messageTypeSpecificFlags,
  serialization,
  compression
}: {
  messageType: MessageType;
  messageTypeSpecificFlags: MessageTypeSpecificFlags;
  serialization: MessageSerialization;
  compression: MessageCompression;
}): Buffer {
  const header = Buffer.alloc(4);
  const headerSize = 1;

  header[0] = (PROTOCOL_VERSION << 4) | headerSize;
  header[1] = (messageType << 4) | messageTypeSpecificFlags;
  header[2] = (serialization << 4) | compression;
  header[3] = 0x00;

  return header;
}

function encodePayload(
  payload: unknown,
  serialization: MessageSerialization,
  compression: MessageCompression
): Buffer {
  let bytes: Buffer;

  if (serialization === MessageSerialization.NO_SERIALIZATION) {
    if (payload instanceof Uint8Array) {
      bytes = Buffer.from(payload);
    } else if (typeof payload === "string") {
      bytes = Buffer.from(payload, "utf8");
    } else if (payload === null || payload === undefined) {
      bytes = Buffer.alloc(0);
    } else {
      bytes = Buffer.from(String(payload), "utf8");
    }
  } else {
    const jsonText = JSON.stringify(payload ?? {});
    bytes = Buffer.from(jsonText, "utf8");
  }

  if (compression === MessageCompression.GZIP) {
    return gzipSync(bytes);
  }

  return bytes;
}

function decodePayload(
  payloadBytes: Buffer,
  serialization: number,
  compression: number
): unknown {
  let bytes = payloadBytes;

  if (compression === MessageCompression.GZIP && payloadBytes.length > 0) {
    try {
      bytes = gunzipSync(payloadBytes);
    } catch {
      return payloadBytes;
    }
  }

  if (serialization === MessageSerialization.JSON) {
    try {
      return JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    } catch {
      return bytes.toString("utf8");
    }
  }

  if (serialization === MessageSerialization.NO_SERIALIZATION) {
    return bytes;
  }

  return bytes.toString("utf8");
}

function allocUint32(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

function allocInt32(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeInt32BE(value, 0);
  return buffer;
}
