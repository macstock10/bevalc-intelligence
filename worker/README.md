# Worker Structure

`worker/worker.js` is the main Cloudflare Worker router. Feature-specific logic lives in modules.

- `worker/worker.js`: request routing + shared utilities
- `worker/sec_research.js`: SEC Research endpoints + RAG pipeline

If you add a new feature area, prefer a new module and import it in `worker.js`.