# Training Nexa's offline brain for pygame and VPython

This folder fine-tunes Gemma 3 1B (the model behind Nexa's offline mode) on pygame and
VPython coding, and adds the result to Ollama as a separate model, `nexa-coder`. Your
normal `gemma3:1b` is never changed. Nothing here is part of the Nexa installer
(`make-package.ps1` only packs the files it lists).

Everything runs on this PC's CPU; no GPU or internet is needed after setup.

## How it works

1. **Examples** (`data/examples/*.txt`): hand-written chats: requests, bug fixes,
   follow-ups and a few everyday questions, each answered with a complete program.
2. **Checker** (`checker/`): runs every program before it can be trained on. pygame runs
   with no window, simulated time and fake key presses and clicks; VPython runs against a
   strict stand-in (`checker/vpython_stub`) that rejects made-up names like `position=` or
   `vpython.Cube`, which the real one would silently accept or only fail in the browser.
3. **Training** (`train.py`): LoRA, so only about 1% of the weights are trained. Chats are
   laid out exactly like Ollama sends them, with Nexa's real system prompt (read from
   `server.py`) in most of them.
4. **Export** (`export.py`): merges the result into the model, converts it to an 8-bit
   GGUF file with llama.cpp's converter (`tools/llama.cpp-0.7.0`, with its `gguf` package
   installed in `.venv`), and runs `ollama create`. This Ollama version can't import Gemma 3
   safetensors directly; that path needs the MLX runtime, which isn't on this PC.
5. **Test** (`eval.py`): asks a model 30 tasks that are *not* in the training data
   (`data/eval_prompts.jsonl`) and runs its code. Before training, gemma3:1b passed 4/30.

## Results so far (30 held-out tasks)

"Works" = runs, shows something and changes over time (checked automatically); "really
works" = I read the program and it does what was asked.

| Model | Works | Really works |
| --- | --- | --- |
| gemma3:1b (Nexa's default) | 0 | 0 |
| nexa-coder (gemma3:1b + this training) | 0 | 0 to 1 |
| nexa-coder + an example | 4 | about 1 |
| gemma3:4b | 9 | 3, plus 2 nearly |
| gemma3:4b + an example | 12 | 4, plus 2 nearly |
| qwen2.5-coder:7b + an example | 21 | 13, plus 5 nearly |

Training taught the 1B model the real pygame/VPython names (invented ones like
`vpython.Cube` went from 10 answers to 2), but not to write programs that work. The 4B model
is too big to fine-tune on this PC, but showing it a similar tested example helps, mostly
for VPython.

qwen2.5-coder's pygame is good: 9 of its 10 working programs do what was asked (the square
that follows the mouse shakes once it gets there). VPython is weaker: 4 of 11 really work.
Its mistakes run without errors, so the automatic check can't see them: a ball whose bounce
keeps it moving down, an Earth and Moon whose positions never change, a particle 2e-10 m wide
on a 6 cm orbit, a pendulum that gains energy until it loops over the top after 40 seconds.

**Fixing bugs** (2026-10-26, through Nexa's real chat on a spare port; replies in
`out/debug_qwen2.5-coder_7b.jsonl`): 12 broken programs from the tests above, 6 sent with
their error message and 6 with a description of what looks wrong. Read and run by hand:
5 fully fixed (paint, missing `BLACK`, pendulum, projectile that never stopped, shaking
square), 4 half fixed (the error went away but the program was still wrong: Pong scores
drawn on top of each other, a "spinning" rectangle that shows as a blue box, a charged
particle without `/ mass` that flies straight, an Earth circling empty space), 3 not fixed
(the spring still crashed, the ball that won't bounce came back unchanged as "correct", the
invisible particle stayed invisible). Its explanations were often wrong even when its code
was right, and twice it sent a snippet instead of the whole program. Speed: first words
after 6-9 s (69 s when the model wasn't loaded yet), done after 40 s to 3 minutes.

**What Nexa uses:** `server.py` sends pygame/VPython questions that would be answered on this
PC to `qwen2.5-coder:7b` (if installed) and adds the closest example from `data/examples` as an
earlier turn of the chat (`retrieval.py`). The README in the main folder explains it for users.

## Commands

Run these from this folder with its own Python: `.venv\Scripts\python`.

| Step | Command | Time on this PC |
| --- | --- | --- |
| Check examples and build the dataset | `python build_dataset.py` | a few minutes |
| Train | `python train.py --epochs 3` | about 1 hour per epoch |
| Add to Ollama as `nexa-coder` | `python export.py` | about 5 minutes |
| Compare models | `python eval.py gemma3:1b nexa-coder` | about 30 minutes per 1B model |
| ...with an example shown | `python eval.py gemma3:4b --examples chat` | about 70 minutes for the 4B |
| Re-score saved answers | `python eval.py --recheck` | a few minutes |
| Check one program | `python checker\check.py my_game.py` | seconds |

`train.py` saves after every epoch (`out/lora_epoch1`, `out/lora_epoch2`, ...; `out/lora`
is the latest). To export an earlier one: `python export.py --adapter out/lora_epoch2`.
Stopping training with Ctrl+C saves what it has so far.

To use the new model in Nexa, pick `nexa-coder` in the model menu, or set
`ASSISTANT_MODEL=nexa-coder` before starting Nexa.

## Adding more examples

Add a `.txt` file in `data/examples/` (copy the format of an existing one), run
`build_dataset.py` until every program passes, then train again. Keep new examples
different from the tasks in `data/eval_prompts.jsonl`, or the test score stops meaning
anything; the builder warns when a prompt looks too similar.

## Files that stay on this PC

`models/` (the 2 GB Gemma download), `out/` (training results), `tools/` (llama.cpp's
converter) and `.venv/` are in `.gitignore`. To remove the trained model from Ollama:
`ollama rm nexa-coder`. The Gemma weights and anything trained from them are covered by the
[Gemma Terms of Use](https://ai.google.dev/gemma/terms); if you share the trained model,
include that notice.
