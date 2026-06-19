# headless-llm-harness

`council` — a **headless, agentic, model-agnostic LLM harness** over OpenRouter.

Unlike a prompt-runner that only *submits* text, `council` gives the model a
tool loop so it **navigates the codebase itself** (read / glob / grep, and under
`--sandbox write`: edit / write / run), and can convene a **multi-model council**
that fans out to a panel and reconciles to one answer.

It's built to be **shelled out to by other agents** (e.g. Claude Code) the same
way you'd call `codex` or `xcheck` — non-interactive, answer to stdout, trace to
stderr. Companion to:

- **`xcheck`** — single-shot OpenRouter review (submit a diff/file, get findings). `council` is its agentic sibling.
- **`codex`** — single-model agentic CLI. `council` adds model-of-your-choice + a council mode.

Zero npm dependencies (native `fetch`, `util.parseArgs`, `fs.glob`). Node ≥ 22.

## Install

```bash
# from this repo
npm link            # exposes `council` on PATH via package.json "bin"
# or symlink the binary directly
ln -sf "$PWD/bin/council" ~/bin/council

export OPENROUTER_API_KEY=sk-or-...   # https://openrouter.ai/keys
council --help
```

## Quick start

```bash
council "plan adding rate limiting to the /chat route"        # plan (read-only)
council --mode ask "where is the JWT secret loaded?"          # Q&A, cites file:line
council --mode review -f src/db.js "find SQLi and races"      # adversarial review
council --council "is the auth refactor in this repo safe?"   # panel + chair
council --mode build "make test/auth.test.js pass"            # writes + runs
git diff | council --mode review "review this diff"           # seed via stdin
```

## Modes (`--mode`, default `plan`)

| Mode | Sandbox | Purpose |
|---|---|---|
| `ask` | read-only | Answer a question about the code (cites file:line) |
| `plan` | read-only | Produce an implementation plan |
| `review` | read-only | Adversarial bug/design review (`[BLOCKER]/[CONCERN]/[NIT]`) |
| `build` | write | Implement a change under `--root`, verify with tests |
| `test` | write | Run the project's tests/build and report |

## Capabilities (`--sandbox`)

- `read-only` — `read_file` / `list_dir` / `glob` / `grep`. **`--council` always uses this.**
- `write` — also `write_file` / `edit_file` (confined to `--root`) + `run`.

All file tools are confined to `--root` (default cwd), symlink-escape and
no-follow-write guarded.

## Council mode

`--council` runs each panel member as its own independent read-only agent, then a
**chair reconciles by evidence, not majority vote** (a single concrete repro /
cited `file:line` / failed invariant outweighs the others).

```bash
council --council --panel google/gemini-3.1-pro-preview,openai/gpt-5.5,anthropic/claude-opus-4.8 \
        --chair google/gemini-3.1-pro-preview "..."
```

Defaults: panel = `gemini-3.1-pro-preview, gpt-5.5, opus-4.8` (cross-lab);
chair = `gemini-3.1-pro-preview`. A failed member is isolated; the panel proceeds.

## Flags

```
-m, --model MODEL        single-model id            (default: gemini-3.1-pro-preview)
-e, --effort LEVEL       low|medium|high|none       (default: high)
--root DIR               workspace tools are confined to (default: cwd)
--max-steps N            tool-call iterations per agent (default: 30)
-f, --files a,b          seed files injected into the prompt (model can read more)
--panel m1,m2,m3         council panel ids
--chair MODEL            council synthesizer
--provider p1,p2         primary OpenRouter provider(s), tried in order
--backup-provider p3,p4  backup provider(s), tried after the primaries
--allow-fallbacks        allow any other provider if all named ones fail (default: off)
-q, --quiet              print only the final answer
-h, --help
```

Env: `OPENROUTER_API_KEY` (required) · `COUNCIL_MODEL` · `COUNCIL_PANEL` ·
`COUNCIL_CHAIR` · `COUNCIL_PROVIDER` · `COUNCIL_BACKUP_PROVIDER` ·
`COUNCIL_ALLOW_FALLBACKS`.

## Provider routing

For models served by more than one upstream, pin which provider serves the
request (and in what order) via OpenRouter [provider routing][pr]. Primary and
backup combine into one ordered preference list:

```bash
# try DeepInfra first, then Novita, then Fireworks; fail if none can serve it
council -m deepseek/deepseek-chat --provider deepinfra --backup-provider novita,fireworks "..."

# prefer OpenAI, but allow any other provider if it's unavailable
council --provider openai --allow-fallbacks "..."
```

`--allow-fallbacks` off (default) is **strict**: only the named providers, in
order, or the call errors — it never silently reroutes. On means "prefer these,
then anyone". Routing applies to every model call, including council members and
the chair. Slugs are OpenRouter provider ids (`openai`, `anthropic`, `together`,
`deepinfra`, `fireworks`, `novita`, …) — see a model's providers at
`openrouter.ai/<model>`.

[pr]: https://openrouter.ai/docs/features/provider-routing

## Safety

File tools (`read_file`/`list_dir`/`glob`/`grep`/`write_file`/`edit_file`) are
confined to `--root`. **`run` is full bash on your machine** — it *starts* in
`--root` but is **not** sandboxed (`cd ..` / absolute paths escape) and the
denylist is only a speed-bump. The harness's `OPENROUTER_API_KEY` is stripped
from `run`'s environment, and backgrounded jobs (`cmd &`) are terminated when the
command returns. For untrusted tasks, run inside a container/VM. `--council`
forces read-only, so panel members never write or run.

## Development

```bash
npm test            # node --test (offline unit tests; no API calls)
```

The binary is a single file (`bin/council`) with an `if (require.main === module)`
guard, so the test suite `require()`s its internals directly.
