"""Scores Ollama models on pygame/VPython tasks they never saw in training.

    python eval.py gemma3:1b nexa-coder
    python eval.py nexa-coder --examples chat    # also show the closest tested example
    python eval.py --recheck                     # re-score every saved answer with the current checker

Each model answers every task in data/eval_prompts.jsonl with Nexa's real system prompt,
then the main program in each answer is run by checker/check.py. Two scores:

- runs:  uses the library that was asked for and runs without errors (for pygame, it also
         draws frames and closes when the window is closed)
- works: runs, shows something, and changes over time (unless the task is a still picture).
         Stricter, but it still can't tell whether the program does exactly what was asked,
         so read the passing answers before trusting a number.

--examples adds the most similar tested example (retrieval.py), either as a note under the
question (the way Nexa adds web search results) or as an earlier turn of the chat. An
answer that mostly copies that example fails, since it would run without doing the task.

Answers and results are saved to out/eval_<model>[_ex-<mode>].jsonl.
"""

import argparse
import difflib
import json
import sys
import time
from datetime import datetime
from pathlib import Path

import httpx

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE / "checker"))
from check import check_answer, kind_of, main_program, works  # noqa: E402
from nexa_prompt import nexa_system_prompt  # noqa: E402
from retrieval import ExampleIndex, reference_note  # noqa: E402

OLLAMA = "http://127.0.0.1:11434"
# The same settings for every model, so only the training differs.
OPTIONS = {"temperature": 0.3, "top_p": 0.95, "top_k": 64, "seed": 7, "num_predict": 2048, "num_ctx": 4096}
COPY_LIMIT = 0.8  # share of lines shared with the example above which an answer counts as a copy
KINDS = ("pygame", "vpython")


def build_messages(prompt, example, mode):
    messages = [{"role": "system", "content": nexa_system_prompt(when=datetime(2026, 10, 22, 15, 0))}]
    if example and mode == "chat":
        messages += [{"role": "user", "content": example["prompt"]},
                     {"role": "assistant", "content": example["answer"]}]
    if example and mode == "note":
        prompt = f"{prompt}\n\n---\n{reference_note(example)}"
    return messages + [{"role": "user", "content": prompt}]


def ask(model, messages):
    r = httpx.post(f"{OLLAMA}/api/chat", timeout=900, json={
        "model": model, "stream": False, "options": OPTIONS, "keep_alive": "10m", "messages": messages,
    })
    r.raise_for_status()
    return r.json()["message"]["content"]


def copied_share(code, example_code):
    """How much of the answer's code is line-for-line the example's code (0 to 1)."""
    mine = [line.strip() for line in code.splitlines() if line.strip()]
    theirs = [line.strip() for line in example_code.splitlines() if line.strip()]
    matcher = difflib.SequenceMatcher(None, mine, theirs, autojunk=False)
    same = sum(block.size for block in matcher.get_matching_blocks())
    return same / max(1, len(mine))


def judge(task, answer, example):
    """The check result for one answer, with "ok" (runs) and "works"."""
    code = main_program(answer)
    used = kind_of(code) if code else None
    if code and used != task["kind"]:
        # Wrong library (e.g. turtle): don't run it, it could open windows on this PC
        res = {"ok": False, "kind": used, "error": f"used {used} instead of {task['kind']}"}
    elif code and example and copied_share(code, example["code"]) >= COPY_LIMIT:
        res = {"ok": False, "kind": used, "error": "mostly copied the example instead of doing the task"}
    else:
        res = check_answer(answer)
        res.pop("code", None)
    res["works"] = works(res, task.get("static", False))
    if example:
        res["example"] = example["where"]
    return res


def line(task, res, seconds=None):
    took = f" ({seconds:.0f}s)" if seconds is not None else ""
    if res["works"]:
        return f"  WORKS {task['id']}{took}"
    if res["ok"]:
        why = "draws nothing" if not res.get("draws") else "nothing changes on screen"
        return f"  RUNS  {task['id']}{took}: {why}"
    return f"  FAIL  {task['id']}{took}: {res['error']}"


def tally(rows):
    score = {k: {"runs": 0, "works": 0, "total": 0} for k in KINDS}
    for task, res in rows:
        s = score[task["kind"]]
        s["total"] += 1
        s["runs"] += res["ok"]
        s["works"] += res["works"]
    return score


def evaluate(model, tasks, mode=None, index=None, resume=False):
    suffix = f"_ex-{mode}" if mode else ""
    out = HERE / "out" / f"eval_{model.replace(':', '_').replace('/', '_')}{suffix}.jsonl"
    out.parent.mkdir(exist_ok=True)
    saved = {}
    if resume and out.exists():  # reuse answers from an earlier, interrupted run
        saved = {r["id"]: r["answer"] for r in map(json.loads, out.read_text(encoding="utf-8").splitlines()) if r}
    rows = []
    with out.open("w", encoding="utf-8") as f:
        for t in tasks:
            start = time.time()
            example = index.best(t["prompt"]) if index else None
            answer = saved.get(t["id"]) or ask(model, build_messages(t["prompt"], example, mode))
            res = judge(t, answer, example)
            print(line(t, res, time.time() - start), flush=True)
            f.write(json.dumps({**t, "answer": answer, "result": res}) + "\n")
            rows.append((t, res))
    return tally(rows)


def recheck(tasks, index):
    """Re-scores every saved answer file with the current checker (no model is asked)."""
    by_id = {t["id"]: t for t in tasks}
    examples = {item["where"]: item for item in index.items}
    summary = []
    for path in sorted((HERE / "out").glob("eval_*.jsonl")):
        saved = [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]
        rows = []
        for r in saved:
            task = {**by_id.get(r["id"], {}), **{k: r[k] for k in ("id", "kind", "prompt")}}
            example = examples.get(r["result"].get("example"))
            r["result"] = judge(task, r["answer"], example)
            rows.append((task, r["result"]))
        path.write_text("".join(json.dumps(r) + "\n" for r in saved), encoding="utf-8")
        summary.append((path.stem[len("eval_"):], tally(rows)))
    return summary


def print_summary(summary):
    print("\n" + "answers".ljust(26) + "pygame works/runs   vpython works/runs   all works/runs")
    for name, s in summary:
        cells = [f"{s[k]['works']:>2} / {s[k]['runs']:>2} of {s[k]['total']}" for k in KINDS]
        w = sum(s[k]["works"] for k in KINDS)
        r = sum(s[k]["runs"] for k in KINDS)
        n = sum(s[k]["total"] for k in KINDS)
        print(f"{name:<26}{cells[0]:<20}{cells[1]:<21}{w:>2} / {r:>2} of {n}")


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # error messages can hold any character
    ap = argparse.ArgumentParser()
    ap.add_argument("models", nargs="*", default=["gemma3:1b"])
    ap.add_argument("--examples", choices=["note", "chat"], help="show the closest tested example")
    ap.add_argument("--recheck", action="store_true", help="re-score all saved answers, ask no model")
    ap.add_argument("--resume", action="store_true", help="keep answers already saved by an interrupted run")
    args = ap.parse_args()
    tasks = [json.loads(x) for x in (HERE / "data" / "eval_prompts.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
    if args.recheck:
        print_summary(recheck(tasks, ExampleIndex()))
        return
    index = ExampleIndex() if args.examples else None
    summary = []
    for m in args.models:
        print(f"{m}:", flush=True)
        summary.append((m + (f" (examples: {args.examples})" if args.examples else ""),
                        evaluate(m, tasks, args.examples, index, args.resume)))
    print_summary(summary)


if __name__ == "__main__":
    main()
