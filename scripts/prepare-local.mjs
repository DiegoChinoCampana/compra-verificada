/**
 * Crea server/.env desde .env.example si no existe y rellena DB_USER con el usuario del sistema (macOS/Linux).
 * Uso: npm run prepare:local (desde la raíz del repo).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverEnv = path.join(root, "server", ".env");
const example = path.join(root, "server", ".env.example");

if (fs.existsSync(serverEnv)) {
  console.log("[prepare:local] server/.env ya existe (no se sobrescribe).");
  process.exit(0);
}

if (!fs.existsSync(example)) {
  console.error("[prepare:local] Falta server/.env.example");
  process.exit(1);
}

let text = fs.readFileSync(example, "utf8");
if (text.includes("tu_usuario_sistema") && os.platform() !== "win32") {
  const u = process.env.USER || process.env.USERNAME || "postgres";
  text = text.replace(/^DB_USER=tu_usuario_sistema$/m, `DB_USER=${u}`);
}

fs.writeFileSync(serverEnv, text, "utf8");
console.log("[prepare:local] Creado server/.env desde .env.example");
console.log("[prepare:local] Revisá: OPENAI_API_KEY, DB_PASSWORD si aplica, y ejecutá: npm run db:ensure");
console.log("[prepare:local] Luego: npm run dev   (api :3001 + web con proxy /api)");
