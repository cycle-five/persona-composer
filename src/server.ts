import express from "express";
import { registerRoutes } from "./routes";
import { getServerPort } from "./config";

/**
 * The persona-composer HTTP service. Mounts the routes at the root and binds to
 * localhost. This is the canonical way to run the tool.
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
    console.log(`[persona-composer] server on http://127.0.0.1:${port}`);
    console.log(`[persona-composer] open http://127.0.0.1:${port}/ for the UI`);
  });
}

main().catch((err) => {
  console.error("[persona-composer] failed to start:", err);
  process.exit(1);
});
