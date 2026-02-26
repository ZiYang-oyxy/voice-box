# voice-box

`voice-box` is a local web voice assistant for macOS using your OpenAI API key.

Pipeline:

1. Press-to-talk recording in browser
2. STT (`audio/transcriptions`)
3. LLM response (`responses`)
4. TTS stream (`audio/speech`)

## Requirements

- macOS with microphone + speaker
- Node.js 20+
- OpenAI API key with access to STT/TTS/Responses

## Quick Start

```bash
cp .env.example .env
# edit .env and set OPENAI_API_KEY
# optional: set OPENAI_BASE_URL if you use an OpenAI-compatible gateway
npm install
npm run dev
```

- Client: `http://127.0.0.1:5173`
- Server: `http://127.0.0.1:8787`

## Environment Variables

```bash
OPENAI_API_KEY=sk-xxxx
OPENAI_BASE_URL=
OPENAI_STT_MODEL=gpt-4o-mini-transcribe
OPENAI_LLM_MODEL=gpt-4.1-mini
OPENAI_TTS_MODEL=gpt-4o-mini-tts
DEFAULT_VOICE=marin
HOST=127.0.0.1
PORT=8787
SAVE_HISTORY=true
```

- Leave `OPENAI_BASE_URL` empty to use the default OpenAI endpoint.
- Set `OPENAI_BASE_URL` (for example, `https://your-gateway.example.com/v1`) when routing through a compatible proxy or self-hosted gateway.

## API

- `GET /api/health`
- `POST /api/voice/turn` (`multipart/form-data`, field `audio` required)
- `POST /api/voice/interrupt` (`{ sessionId }`)
- `GET /api/history`
- `GET /api/history/:sessionId`

## Notes

- History logs are saved to `data/sessions/*.jsonl`
- Browser receives no permanent OpenAI key
- Press while AI is speaking to interrupt and start a new turn
