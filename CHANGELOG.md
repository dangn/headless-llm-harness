# Changelog

All notable changes to `council` are recorded here.

## [0.1.0] — 2026-06-19 14:05 PT

Initial release. Extracted `~/bin/council` into a standalone project
(`~/ws/headless-llm-harness`); `~/bin/council` is now a symlink to `bin/council`.

### Added
- **Agentic tool loop** over OpenRouter — the model drives `read_file`,
  `list_dir`, `glob`, `grep`, and (under `--sandbox write`) `write_file`,
  `edit_file`, `run`. All file tools confined to `--root` (symlink-escape +
  no-follow-write guarded).
- **Modes**: `ask`, `plan`, `review` (read-only) and `build`, `test` (write+run).
- **`--council`** multi-model mode: cross-lab panel (default
  `gemini-3.1-pro-preview`, `gpt-5.5`, `opus-4.8`) each runs its own read-only
  agent, then a chair reconciles by evidence (not majority vote). Forced
  read-only; a failed member is isolated.
- **Seed material**: `-f file,file` and piped stdin (idle-timeout drained, never
  blocks headless).
- Per-run header to stderr with model, mode, sandbox, wall time, and OpenRouter
  cost (`usage:{include:true}`); answer to stdout.
- Zero npm dependencies (native `fetch`, `util.parseArgs`, `fs.glob`); Node ≥ 22.

### Hardened (two adversarial review rounds: Codex gpt-5.5 @ xhigh + Claude/Gemini)
- `callOR`: abort timer held through the body read; transient provider errors
  (429/5xx/"provider returned error") retry, real 4xx fail fast; a timed-out or
  malformed body no longer swallows to `{}` (was surfacing as a false "empty
  response from <model>" and skipping retry).
- `run`: detached process group + resolve on `exit` (not `close`, which hung on
  backgrounded descendants); SIGTERM→SIGKILL escalation timer stored and cleared;
  backgrounded jobs swept on return; `OPENROUTER_API_KEY` stripped from env.
- `read_file`: streamed paging + `HARD_READ_MAX` (no OOM when `start_line` is
  set); `fs.ReadStream` destroyed on every exit; `end_line < start_line` errors
  clearly; whole-file read trims the trailing-newline ghost line.
- `grep`: inline byte cap that slices the cap-crossing chunk and kills `rg`.
- Final max-steps request keeps `tools` with `tool_choice:"none"` (some providers
  reject tool history when `tools` is absent).
- Assistant turns pushed verbatim so `reasoning_details`/`tool_calls` survive
  multi-turn tool calling.

### Notes / known limitations
- `run` is full bash, not a sandbox (documented in `--help` and README).
- TOCTOU between path guard and fs op is accepted: `--sandbox write` already
  grants `run` (full shell), so a racing symlink swap grants no new capability.
- `readStdin` drops a first byte that arrives >3s after launch (deliberate
  "never block headless" tradeoff).
