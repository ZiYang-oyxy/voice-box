import { ConnectionStatus } from "./components/ConnectionStatus";
import { PushToTalkButton } from "./components/PushToTalkButton";
import { TranscriptPanel } from "./components/TranscriptPanel";
import { useRealtimeVoice } from "./hooks/useRealtimeVoice";

export function App(): JSX.Element {
  const voice = useRealtimeVoice();

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Local Voice AI Console</p>
          <h1>按住说话，实时全双工对话</h1>
        </div>
        <button
          className="reset-button"
          type="button"
          onClick={() => {
            void voice.resetSession();
          }}
        >
          新会话
        </button>
      </header>

      <section className="layout-grid">
        <aside className="left-rail">
          <ConnectionStatus state={voice.state} error={voice.error} sessionId={voice.sessionId} />

          <PushToTalkButton
            recording={voice.state === "recording"}
            busy={voice.state === "connecting" || voice.state === "responding"}
            onPressStart={voice.beginPress}
            onPressEnd={voice.endPress}
          />

          <p className="helper-text">支持鼠标、触屏和键盘空格键。播报中再次按住会立即打断并开始新输入。</p>
        </aside>

        <TranscriptPanel turns={voice.turns} />
      </section>
    </main>
  );
}
