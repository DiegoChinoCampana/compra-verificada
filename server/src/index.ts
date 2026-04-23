import { app } from "./app.js";
import { ensureSchema } from "./db.js";

const port = Number(process.env.PORT ?? 3001);

async function start() {
  await ensureSchema();
  app.listen(port, () => {
    console.log(`CompraVerificada API http://localhost:${port}`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
