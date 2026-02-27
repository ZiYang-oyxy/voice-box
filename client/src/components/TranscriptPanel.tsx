import type { TranscriptItem } from "../hooks/useRealtimeVoice";

type TranscriptPanelProps = {
  turns: TranscriptItem[];
};

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

export function TranscriptPanel({ turns }: TranscriptPanelProps): JSX.Element {
  return (
    <section className="transcript-panel" aria-label="Transcript">
      <header className="transcript-header">
        <h2>会话转写</h2>
        <span>{turns.length} turns</span>
      </header>

      {turns.length === 0 ? (
        <p className="transcript-empty">还没有对话记录。按住按钮开始第一轮语音交流。</p>
      ) : (
        <ul className="transcript-list">
          {turns.map((turn) => (
            <li className="turn-card" key={turn.id}>
              <div className="turn-time">{timeFormatter.format(new Date(turn.createdAt))}</div>
              <p>
                <strong>{labelForRole(turn.role)}:</strong> {turn.text}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function labelForRole(role: TranscriptItem["role"]): string {
  if (role === "user") {
    return "You";
  }
  if (role === "assistant") {
    return "AI";
  }
  return "System";
}
