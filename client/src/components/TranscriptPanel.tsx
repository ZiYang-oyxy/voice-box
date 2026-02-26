import type { TurnRecord } from "../hooks/useVoiceTurn";

type TranscriptPanelProps = {
  turns: TurnRecord[];
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
                <strong>You:</strong> {turn.userText}
              </p>
              <p>
                <strong>AI:</strong> {turn.assistantText}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
