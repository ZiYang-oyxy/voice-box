type PushToTalkButtonProps = {
  recording: boolean;
  busy: boolean;
  onPressStart: () => Promise<void> | void;
  onPressEnd: () => Promise<void> | void;
};

export function PushToTalkButton({
  recording,
  busy,
  onPressStart,
  onPressEnd
}: PushToTalkButtonProps): JSX.Element {
  const label = recording ? "松开发送" : busy ? "处理中..." : "按住说话";

  return (
    <button
      type="button"
      className="ptt-button"
      data-recording={recording}
      data-busy={busy}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        void onPressStart();
      }}
      onPointerUp={(event) => {
        event.preventDefault();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        void onPressEnd();
      }}
      onPointerCancel={() => {
        void onPressEnd();
      }}
      onKeyDown={(event) => {
        if ((event.key === " " || event.key === "Enter") && !event.repeat) {
          event.preventDefault();
          void onPressStart();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          void onPressEnd();
        }
      }}
      aria-label="Press and hold to talk"
    >
      <span className="ptt-core" />
      <span className="ptt-label">{label}</span>
    </button>
  );
}
