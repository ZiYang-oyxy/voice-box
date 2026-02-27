#!/usr/bin/env python3
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

python minimax_t2a_http_probe.py --url "https://xiaohumini.site/minimax/v1/t2a_v2" --api-key "sk-xxx"

def build_payload(model: str, text: str, voice_id: str) -> dict:
    return {
        "model": model,
        "text": text,
        "voice_setting": {
            "voice_id": voice_id,
            "speed": 1.0,
            "vol": 1.0,
            "pitch": 0,
        },
        "audio_setting": {
            "sample_rate": 32000,
            "bitrate": 128000,
            "format": "mp3",
            "channel": 1,
        },
    }


def run_http_t2a(url: str, api_key: str, payload: dict, output: str, timeout_s: float) -> int:
    req = urllib.request.Request(
        url=url,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            status = resp.getcode()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        print(f"[error] http status={e.code}")
        print(detail)
        return 2
    except Exception as e:  # noqa: BLE001
        print(f"[error] request failed: {e}")
        return 1

    if status != 200:
        print(f"[error] unexpected status={status}")
        print(body)
        return 3

    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        print("[error] response is not json")
        print(body[:300])
        return 4

    audio_hex = ((data or {}).get("data") or {}).get("audio")
    if not audio_hex:
        print("[error] no data.audio in response")
        print(json.dumps(data, ensure_ascii=False, indent=2)[:1200])
        return 5

    try:
        audio_bytes = bytes.fromhex(audio_hex)
    except ValueError:
        print("[error] data.audio is not valid hex")
        return 6

    out_path = Path(output)
    out_path.write_bytes(audio_bytes)
    print("[ok] t2a http call succeeded")
    print(f"[ok] saved: {out_path.resolve()}")
    extra = data.get("extra_info")
    if extra:
        print("[info] extra_info:")
        print(json.dumps(extra, ensure_ascii=False, indent=2))
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Probe MiniMax speech-2.6-turbo via HTTP /minimax/v1/t2a_v2")
    parser.add_argument(
        "--url",
        default=os.getenv("MINIMAX_T2A_HTTP_URL", "https://xiaohumini.site/minimax/v1/t2a_v2"),
        help="HTTP endpoint, default: https://xiaohumini.site/minimax/v1/t2a_v2",
    )
    parser.add_argument("--api-key", default=os.getenv("MINIMAX_API_KEY", ""))
    parser.add_argument("--model", default=os.getenv("MINIMAX_MODEL", "speech-2.6-turbo"))
    parser.add_argument("--voice-id", default=os.getenv("MINIMAX_VOICE_ID", "male-qn-qingse"))
    parser.add_argument("--text", default="你好，这是 speech-2.6-turbo 的HTTP验证。")
    parser.add_argument("--output", default="minimax_t2a_http_output.mp3")
    parser.add_argument("--timeout", type=float, default=30.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.api_key:
        print("[error] missing --api-key (or MINIMAX_API_KEY)")
        return 10

    payload = build_payload(args.model, args.text, args.voice_id)
    return run_http_t2a(args.url, args.api_key, payload, args.output, args.timeout)


if __name__ == "__main__":
    sys.exit(main())
