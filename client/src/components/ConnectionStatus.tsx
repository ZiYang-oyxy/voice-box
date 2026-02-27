import type { VoiceState } from "../hooks/useRealtimeVoice";

type ConnectionStatusProps = {
  state: VoiceState;
  sessionId: string | null;
  error: string | null;
};

const stateLabelMap: Record<VoiceState, string> = {
  idle: "待命",
  connecting: "连接中",
  recording: "录音中",
  responding: "播报中",
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
        {state === "responding" ? "正在播放，按住可立即打断" : "按住讲话，松开提交语音"}
      </div>
      {error ? <p className="status-error">{error}</p> : null}
    </section>
  );
}
