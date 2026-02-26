import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ConversationMessage, SessionEvent, SessionMeta } from "../types.js";

const DEFAULT_CONTEXT_TURNS = 12;

export class SessionStore {
  public constructor(
    private readonly baseDir: string,
    private readonly saveHistory: boolean
  ) {}

  public async appendEvent(
    sessionId: string,
    type: string,
    payload: Record<string, unknown> = {}
  ): Promise<void> {
    if (!this.saveHistory) {
      return;
    }

    await this.ensureBaseDir();

    const ts = new Date().toISOString();
    const event: SessionEvent = {
      ts,
      type,
      payload
    };

    await appendFile(this.eventsPath(sessionId), `${JSON.stringify(event)}\n`, "utf8");
    await this.updateMeta(sessionId, type, ts);
  }

  public async listSessions(): Promise<SessionMeta[]> {
    if (!this.saveHistory) {
      return [];
    }

    await this.ensureBaseDir();
    const files = await readdir(this.baseDir);
    const metaFiles = files.filter((file) => file.endsWith(".meta.json"));

    const sessions = await Promise.all(
      metaFiles.map(async (fileName): Promise<SessionMeta | null> => {
        try {
          const filePath = path.join(this.baseDir, fileName);
          const raw = await readFile(filePath, "utf8");
          const parsed = JSON.parse(raw) as SessionMeta;

          if (!parsed.sessionId) {
            return null;
          }

          return parsed;
        } catch {
          return null;
        }
      })
    );

    return sessions
      .filter((session): session is SessionMeta => session !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  public async getSessionEvents(sessionId: string): Promise<SessionEvent[]> {
    if (!this.saveHistory) {
      return [];
    }

    try {
      const raw = await readFile(this.eventsPath(sessionId), "utf8");
      return raw
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as SessionEvent];
          } catch {
            return [];
          }
        });
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }

      throw error;
    }
  }

  public async getConversationMessages(
    sessionId: string,
    maxTurns = DEFAULT_CONTEXT_TURNS
  ): Promise<ConversationMessage[]> {
    const events = await this.getSessionEvents(sessionId);
    const completedTurns = events
      .filter((event) => event.type === "turn_completed")
      .slice(-maxTurns);

    const messages: ConversationMessage[] = [];

    for (const turn of completedTurns) {
      const userText = typeof turn.payload.userText === "string" ? turn.payload.userText : "";
      const assistantText =
        typeof turn.payload.assistantText === "string" ? turn.payload.assistantText : "";

      if (userText.trim().length > 0) {
        messages.push({ role: "user", text: userText });
      }

      if (assistantText.trim().length > 0) {
        messages.push({ role: "assistant", text: assistantText });
      }
    }

    return messages;
  }

  private async ensureBaseDir(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  private eventsPath(sessionId: string): string {
    return path.join(this.baseDir, `${sessionId}.jsonl`);
  }

  private metaPath(sessionId: string): string {
    return path.join(this.baseDir, `${sessionId}.meta.json`);
  }

  private async updateMeta(sessionId: string, eventType: string, nowIso: string): Promise<void> {
    const filePath = this.metaPath(sessionId);

    let meta: SessionMeta;
    try {
      const raw = await readFile(filePath, "utf8");
      meta = JSON.parse(raw) as SessionMeta;
    } catch (error) {
      if (error instanceof Error || isMissingFileError(error)) {
        meta = {
          sessionId,
          createdAt: nowIso,
          updatedAt: nowIso,
          turns: 0,
          errors: 0
        };
      } else {
        throw error;
      }
    }

    meta.updatedAt = nowIso;

    if (eventType === "turn_completed") {
      meta.turns += 1;
    }

    if (eventType.includes("error")) {
      meta.errors += 1;
    }

    await writeFile(filePath, JSON.stringify(meta, null, 2), "utf8");
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
