import type { VoiceState } from "../hooks/useVoiceTurn";

type ConnectionStatusProps = {
  state: VoiceState;
  sessionId: string | null;
  error: string | null;
};

const stateLabelMap: Record<VoiceState, string> = {
  idle: "待命",
  recording: "录音中",
  uploading: "上传音频",
  thinking: "思考中",
  speaking: "播报中",
  error: "异常"
};

export function ConnectionStatus({ state, sessionId, error }: ConnectionStatusProps): JSX.Element {
  return (
    <section className="status-panel" aria-live="polite">
      <div className="status-row">
        <span className="status-dot" data-state={state} />
        <span className="status-title">{stateLabelMap[state]}</span>
      </div>
      <div className="status-meta">Session: {sessionId ?? "(new)"}</div>
      <div className="status-meta status-tip">
        {state === "speaking" ? "正在播放，按住可立即打断" : "按住讲话，松开发送"}
      </div>
      {error ? <p className="status-error">{error}</p> : null}
    </section>
  );
}
