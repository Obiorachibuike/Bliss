# Desktop host — implementation pending

This workspace is reserved for Tauri 2 and Rust. The host, capability configuration and packaging are not implemented in this draft.

The host must own native file selection, canonical path validation, OS keychain access, a per-launch worker secret, loopback Python worker lifecycle, typed IPC and forwarding of progress events. React must not control subprocesses or receive provider credentials. See the root implementation plan and release checklist before treating this workspace as usable.
