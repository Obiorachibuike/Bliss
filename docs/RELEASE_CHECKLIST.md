# Release checklist — work in progress

This branch is an **implementation draft**, not a completed commercial application. Implemented modules are not equivalent to an integrated or production-verified product.

## Implemented in the draft

- [x] npm/pnpm workspace layout, strict TypeScript configuration, Vite entry point and shared contracts.
- [x] Python configuration, typed data models and actionable error types.
- [x] SQLite schema/migration and project, transcript, candidate, edit, export and settings repositories.
- [x] FFprobe metadata extraction and FFmpeg audio extraction/thumbnails.
- [x] faster-whisper integration requiring actual word timestamps and an explicitly installed model.
- [x] Deterministic, sentence-aligned local clip ranking with measurable user-facing reasons.
- [x] Transcript-only provider adapters for OpenAI, Anthropic, Gemini, approved custom endpoints and loopback Ollama.
- [x] OpenCV face detection, crop smoothing and bounded interpolation expressions.
- [x] ASS caption/headline generation and real FFmpeg H.264/AAC rendering modules.
- [x] Background job primitives, cancellation, persistence and progress subscriptions.
- [x] Structured logs excluding transcript text and credentials.

## Required before the application is usable

- [ ] Connect modules to authenticated FastAPI routes and WebSocket endpoints.
- [ ] Implement shared backend adapters and application-state wiring.
- [ ] Implement dashboard, explicit-consent import, discovery, editing, privacy, settings and export screens.
- [ ] Implement the Tauri/Rust host, secure IPC, OS keychain integration and worker lifecycle.
- [ ] Wire the first-run experience and model installation UI.
- [ ] Add licensing interfaces without simulated payment validation.
- [ ] Run the complete workflow against real speech and a cached Whisper model.
- [ ] Complete component, IPC, cancellation, reconnect and persistence tests.
- [ ] Validate Windows/macOS installation and native packaging.
- [ ] Add deployment authentication, request limits and security review before internet exposure.

## Known limitations

- The browser currently opens an explicitly labeled development-status screen, not the clipping workflow.
- FastAPI routes and desktop binaries are not present; the engine cannot yet be controlled from the UI.
- No source upload or cloud-processing flow is currently exposed.
- Model download attempts could not reach Hugging Face in the implementation sandbox. Actual transcription remains unverified until a real model is available.
- Local clip ranking is a transparent lexical/temporal heuristic, not an embedding model or local LLM. It is not a virality prediction.
- The active-speaker option uses visual mouth-motion heuristics, not audio diarization.
- Scene detection uses a sparse OpenCV histogram pass, not frame-exact editorial boundaries.
- A native Rust/Tauri toolchain was unavailable in the implementation environment; native behavior is not verified.

Do not remove this checklist or claim final acceptance until the unchecked items have actually been implemented and tested.
