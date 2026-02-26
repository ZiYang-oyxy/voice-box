import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import OpenAI from "openai";
import { loadConfig } from "./env.js";

const serviceDir = path.dirname(fileURLToPath(import.meta.url));
const rootEnvFile = path.resolve(serviceDir, "../../../.env");

dotenv.config({ path: rootEnvFile });
dotenv.config();

export const config = loadConfig();

export const openai = new OpenAI({
  apiKey: config.openaiApiKey,
  baseURL: config.openaiBaseUrl
});
