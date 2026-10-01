# ClipShip

**Turn long videos into publish-ready short clips — privately, locally, and intelligently.**

> **Work in progress:** This branch introduces the workspace foundation and Python media-engine modules. It is not yet a usable end-to-end clipping application. The browser entry point displays an honest development-status screen. See [the implementation plan](docs/IMPLEMENTATION_PLAN.md) and [release checklist](docs/RELEASE_CHECKLIST.md).

## Architecture

```text
apps/web/           Vite browser entry point
apps/desktop/       Reserved for the Tauri 2 desktop host (not implemented yet)
packages/ui/        Shared React entry point and component-test setup
packages/types/     Shared TypeScript contracts
packages/api/       Backend-adapter workspace (implementation pending)
packages/state/     Zustand workspace (implementation pending)
packages/config/    Shared Tailwind configuration
python/app/         Local transcription, discovery, tracking, captions, rendering,
                    SQLite persistence and asynchronous job primitives
python/tests/       Engine unit and media integration tests
```

The intended desktop flow is React → Tauri IPC → Rust-owned Python worker → FFmpeg/models. The UI must not own Python processes or perform heavy video processing. FastAPI routes and the Rust bridge are still to be implemented.

## Privacy model

- **Desktop Local AI:** Source references, extracted audio, transcripts, ranking, tracking and rendering are intended to stay on the computer. Model installation is an explicit network operation.
- **API AI:** Provider adapters accept transcript text, not video/audio paths or media bytes. External analysis requires explicit transcript-sharing consent.
- **Browser:** The eventual web workflow requires an explicitly consented upload to its hosting server. It must never be represented as on-device desktop processing. No upload UI is exposed in this draft.
- Provider credentials belong in the server environment or, once implemented, the desktop OS keychain. Never put secrets in `VITE_*` variables or commit `.env`.

## Prerequisites

- Node.js 22+ and npm 10+ (or pnpm with the provided workspace configuration).
- Python 3.11+.
- FFmpeg and FFprobe on `PATH`, or explicit `FFMPEG_PATH` / `FFPROBE_PATH` environment variables.
- A locally installed CTranslate2 Whisper model for actual transcription.
- Future desktop integration requires a current Rust toolchain and the [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/).

The optional Linux FFmpeg/FFprobe npm packages are a development-sandbox fallback, not a native cross-platform packaging solution.

## Development

```bash
npm ci
npm run dev
```

Vite binds `0.0.0.0:5173` and allows the Arena preview host. The reserved `/api` proxy targets `http://127.0.0.1:8000`; browser code should use same-origin URLs. There is no running API implementation in this draft.

Python on macOS/Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r python/requirements.txt
```

Python on Windows PowerShell:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r python/requirements.txt
```

On macOS, FFmpeg can be installed with `brew install ffmpeg`. On Windows, install FFmpeg with your preferred trusted package manager, add its `bin` directory to `PATH`, and verify both `ffmpeg -version` and `ffprobe -version`. On Linux, install the distribution's FFmpeg package. Restart shells and the eventual worker after changing `PATH`.

## Local models

`Transcriber` reads models from `MODEL_DIR/<model-name>/`, requiring `model.bin`, `config.json` and `tokenizer.json`. Supported names are `tiny`, `base`, `small`, `medium` and `large-v3`. Copy a compatible faster-whisper/CTranslate2 model there or invoke the explicit install module after job/API wiring is complete.

Ordinary transcription uses `local_files_only=True`. It never silently downloads a model or uploads a recording. A missing model produces `MODEL_UNAVAILABLE` with instructions, not fabricated timestamps or clips. CPU/int8 is the default; CUDA requires separately compatible NVIDIA dependencies.

## Configuration

Copy `.env.example` to `.env` as a reference and export the desired variables in your process environment. This draft does not automatically load `.env`.

Notable settings: `DATA_DIR`, `MODEL_DIR`, `FFMPEG_PATH`, `FFPROBE_PATH`, `WHISPER_DEVICE`, `WHISPER_COMPUTE_TYPE`, optional provider keys, `OLLAMA_BASE_URL`, and `AI_ALLOWED_ENDPOINTS`. Custom remote providers require an explicitly approved HTTPS origin. Desktop workers require a per-launch `CLIPSHIP_WORKER_TOKEN`; that lifecycle is not yet wired.

## Validation

```bash
npm run typecheck
npm run lint
npm test
npm run build
# With the Python virtual environment active:
python -m pytest python/tests -q
python -m compileall -q python/app
```

The tests use clearly labeled synthetic transcript fixtures for deterministic boundary/scoring assertions. They do not claim to test Whisper inference. The media integration test creates and renders a real short video with FFmpeg and verifies its codec, dimensions and duration with FFprobe.

Actual transcription, the full import → export workflow, native IPC, platform packaging and browser end-to-end tests remain release blockers. No installer or production deployment is supplied yet.

## Troubleshooting

- **Missing FFmpeg/FFprobe:** Check `PATH` or set their full executable paths.
- **Model unavailable:** Install the selected CTranslate2 model into `MODEL_DIR` before transcription.
- **Download blocked:** Download on a network that can reach Hugging Face and transfer model files manually; source recordings are not needed for model installation.
- **GPU unavailable:** Use `WHISPER_DEVICE=cpu` and `WHISPER_COMPUTE_TYPE=int8`.
- **Missing source:** Referenced desktop source files must remain at their original locations. The repository intentionally does not duplicate large source recordings.
- **Incomplete UI/API:** This is expected in the draft; track the remaining integration work in the release checklist.
