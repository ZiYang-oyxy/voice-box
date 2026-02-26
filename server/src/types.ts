export type LanguageHint = "auto" | "zh" | "en";

export type ConversationMessage = {
  role: "user" | "assistant";
  text: string;
};

export type SessionEvent = {
  ts: string;
  type: string;
  payload: Record<string, unknown>;
};

export type SessionMeta = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  turns: number;
  errors: number;
};
