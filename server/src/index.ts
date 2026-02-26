import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify from "fastify";

import { healthRoutes } from "./routes/health.js";
import { historyRoutes } from "./routes/history.js";
import { voiceRoutes } from "./routes/voice.js";
import { SessionStore } from "./services/historyStore.js";
import { config } from "./services/openaiClient.js";

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: ["http://127.0.0.1:5173", "http://localhost:5173"]
});

await app.register(multipart, {
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 1,
    fields: 5
  }
});

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const historyDir = path.resolve(currentDir, "../../data/sessions");
const sessionStore = new SessionStore(historyDir, config.saveHistory);

await app.register(healthRoutes);
await app.register(historyRoutes, { store: sessionStore });
await app.register(voiceRoutes, { store: sessionStore });

app.setErrorHandler((error, _request, reply) => {
  reply.code(500).send({
    error: "internal_server_error",
    message: error.message
  });
});

try {
  await app.listen({
    host: config.host,
    port: config.port
  });

  app.log.info(`Voice server ready at http://${config.host}:${config.port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
