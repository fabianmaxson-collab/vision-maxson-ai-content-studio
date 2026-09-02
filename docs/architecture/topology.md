# Phase 0 topology

```text
Browser
  |
  v
Cloudflare DNS/TLS -> Cloudflare Access -> Worker deployment
                                           |-- Workers Static Assets -> React SPA
                                           `-- /api/* -> Hono API
```

Cloudflare Access is the external identity gate. The application-level authorization gate begins in Phase 1. D1, Workflows, Queues, Durable Objects, R2, Google Drive, provider adapters and publishing are deliberately absent from Phase 0.
