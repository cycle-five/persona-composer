import express from "express";
import { registerRoutes } from "./routes";
import { getServerPort } from "./config";

/**
 * Standalone dev server. Runs the exact same routes the SillyTavern plugin
 * exposes, but mounted at the root and bound to localhost — handy for
 * developing the UI without a running SillyTavern instance.
 *
 *   npm run dev      # build + start
 *   npm start        # start an existing build
 */
async function main(): Promise<void> {
  const app = express();
  const router = express.Router();
  await registerRoutes(router);
  app.use("/", router);

  const port = getServerPort();
  app.listen(port, "127.0.0.1", () => {
    console.log(`[persona-composer] standalone server on http://127.0.0.1:${port}`);
    console.log(`[persona-composer] open http://127.0.0.1:${port}/ for the UI`);
  });
}

main().catch((err) => {
  console.error("[persona-composer] failed to start:", err);
  process.exit(1);
});
