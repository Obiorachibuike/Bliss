# ClipShip implementation plan

## Repository audit

The starting repository (commit `54ffa0c`) contains only `README.md`. There is no existing UI, application runtime, data, or functionality to preserve. This is an additive implementation on the existing Arena branch; no repository history is replaced.

## Architecture

- `apps/web`: Vite entry point and proxy for the browser workspace.
- `apps/desktop`: desktop entry point and Tauri 2 host. Rust owns Python worker lifecycle, native file selection, credential storage and IPC. Heavy processing never runs in React.
- `packages/ui`: shared React application, design system and screens.
- `packages/types`: shared contracts.
- `packages/api`: backend adapters, progress subscriptions and reconnect handling.
- `packages/state`: persisted interface preferences and editor drafts.
- `python/app`: actual FFmpeg, faster-whisper, sentence-boundary discovery, OpenCV tracking, ASS captions, rendering, SQLite persistence and cancellable jobs.

## Privacy boundary

Desktop Local AI: referenced source files, extracted audio, transcription, analysis, tracking and renders stay on the computer. Model downloads are a separately disclosed network operation. API AI sends transcript text only, never media. Custom endpoints require explicit selection.

Browser: source uploads are opt-in and are processed on the server hosting the workspace, not on the user's device. This is never described as private desktop processing. A browser file must not be uploaded before explicit consent. Same-origin API/WebSocket URLs work through the preview proxy.

## Incremental implementation

1. Scaffold workspaces, contracts, development tools and architecture.
2. Implement persisted media/project repository, real probing and import, asynchronous jobs and cancellation.
3. Implement word-level local transcription, deterministic semantic candidate ranking, optional transcript-only providers, scene analysis and face tracking.
4. Implement caption editing and ASS rendering, headline overlay, crop/format presets and real H.264/AAC export.
5. Build the shared polished UI: dashboard, import, progress, discovery, editor, exports, privacy center and settings.
6. Implement Tauri IPC, local-worker bridge, keychain abstraction and licensing extension points (no pretend paid activation).
7. Validate TypeScript, lint, production build, Python tests and FFmpeg integration. Add reproducible transcription smoke testing and Rust tests where toolchain prerequisites allow.
8. Document local model installation, Windows/macOS dependencies, packaging gaps and operational limitations honestly.

## Verification and release policy

No fake candidate lists or simulated progress. Tests may use clearly identified synthetic fixture transcripts; production only analyzes real transcripts. Progress is emitted at completed work boundaries and from FFmpeg output. Missing dependencies/models return actionable errors. No automatic model download during ordinary processing. An install action is explicit.

A successful browser smoke test does not prove native packaging or hardware-specific behavior. Any unverified platform/packaging requirements are tracked in `docs/RELEASE_CHECKLIST.md` instead of being claimed complete.
