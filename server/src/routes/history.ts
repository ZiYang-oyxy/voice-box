import type { FastifyPluginAsync } from "fastify";

import type { SessionStore } from "../services/historyStore.js";

type HistoryRoutesOptions = {
  store: SessionStore;
};

export const historyRoutes: FastifyPluginAsync<HistoryRoutesOptions> = async (app, options) => {
  app.get("/api/history", async () => {
    const sessions = await options.store.listSessions();
    return { sessions };
  });

  app.get<{ Params: { sessionId: string } }>("/api/history/:sessionId", async (request, reply) => {
    const events = await options.store.getSessionEvents(request.params.sessionId);

    if (events.length === 0) {
      return reply.code(404).send({ error: "session_not_found" });
    }

    return {
      sessionId: request.params.sessionId,
      events
    };
  });
};
