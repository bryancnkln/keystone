Things to keep in mind

| Area | Note |
|------|------|
| **COOP / COEP** | Without them `SharedArrayBuffer` is blocked. Add the headers in your server or use a service worker to set them. |
| **Worker memory** | The worker receives the same `SharedArrayBuffer`s; no extra copies are made. |
| **No GC** | All allocations happen only at startup – no runtime allocation, no garbage‑collector pauses. |
| **Performance** | All hot paths are `O(N)` with unrolled loops; on modern browsers you’ll get sub‑millisecond routing. |
| **Thread safety** | The ring buffer is lock‑free for a single producer (the worker) and a single consumer (main thread). If you need many producers, add a second CAS loop. |
| **Extensibility** | Add more facets or tools by extending the enums and the tool map. |
