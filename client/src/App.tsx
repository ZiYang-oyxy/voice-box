import { ConnectionStatus } from "./components/ConnectionStatus";
import { PushToTalkButton } from "./components/PushToTalkButton";
import { TranscriptPanel } from "./components/TranscriptPanel";
import { useVoiceTurn } from "./hooks/useVoiceTurn";

export function App(): JSX.Element {
  const voice = useVoiceTurn();

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Local Voice AI Console</p>
          <h1>按住说话，松开对话</h1>
        </div>
        <button className="reset-button" type="button" onClick={voice.resetSession}>
          新会话
        </button>
      </header>

      <section className="layout-grid">
        <aside className="left-rail">
          <ConnectionStatus state={voice.state} error={voice.error} sessionId={voice.sessionId} />

          <PushToTalkButton
            recording={voice.state === "recording"}
            busy={voice.state === "uploading" || voice.state === "thinking"}
            onPressStart={voice.beginPress}
            onPressEnd={voice.endPress}
          />

          <p className="helper-text">支持鼠标、触屏和键盘空格键。AI 播报中再次按住会立即打断。</p>
        </aside>

        <TranscriptPanel turns={voice.turns} />
      </section>
    </main>
  );
}
