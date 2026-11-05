import { createApp } from "./app.js";
import { HelpdeskClient } from "./helpdesk.js";
import { createRepository } from "./repository.js";
import { SyncService } from "./sync.js";

const port = Number(process.env.PORT || 8080);

const repository = createRepository();
const syncService = new SyncService({ client: new HelpdeskClient(), repository });

createApp({ syncService, repository }).listen(port, "0.0.0.0", () => {
  console.log(`listening on http://0.0.0.0:${port}`);
  syncService.start();
});
