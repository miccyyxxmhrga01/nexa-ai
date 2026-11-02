"""Builds data/train.jsonl and data/valid.jsonl from data/examples/*.txt.

    python build_dataset.py

Example files are plain text in sections:

    <<<PROMPT>>>
    Make a ball bounce in pygame.
    <<<PROMPT>>>
    (another way to ask the same thing; each one becomes its own training row)
    <<<ANSWER>>>
    The answer, in Markdown, with one complete program in a ```python block.
    <<<END>>>

More PROMPT/ANSWER pairs before <<<END>>> make a multi-turn chat (follow-ups). Put
<<<CHECK none>>> before <<<END>>> for an answer whose code isn't a whole program.

Every program in an answer is run by checker/check.py and the build stops if any of
them fails, so no broken code is trained on. It also warns when a training prompt is
close to one of the held-out test tasks in data/eval_prompts.jsonl.
"""

import hashlib
import json
import random
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE / "checker"))
from check import check_code, kind_of, main_program  # noqa: E402
from nexa_prompt import nexa_system_prompt  # noqa: E402

EXAMPLES = HERE / "data" / "examples"
CACHE = HERE / "out" / "check_cache.json"
SYSTEM_SHARE = 0.6  # rows that start with Nexa's system prompt; the rest have none
VALID_SHARE = 0.05
MARK = re.compile(r"^<<<(PROMPT|ANSWER|END|CHECK none)>>>[ \t]*$", re.M)


def parse(path):
    """The examples in one file: [{"turns": [(prompts, answer), ...], "check": bool, "where": str}]."""
    text = path.read_text(encoding="utf-8")
    parts = MARK.split(text)
    examples, turns, prompts, check = [], [], [], True
    for i in range(1, len(parts), 2):
        tag, body = parts[i], parts[i + 1].strip("\n")
        if tag == "PROMPT":
            prompts.append(body.strip())
        elif tag == "ANSWER":
            if not prompts:
                raise ValueError(f"{path.name}: an ANSWER with no PROMPT before it")
            turns.append((prompts, body.strip()))
            prompts = []
        elif tag == "CHECK none":
            check = False
        elif tag == "END":
            if prompts or not turns:
                raise ValueError(f"{path.name}: example {len(examples) + 1} doesn't end with an ANSWER")
            examples.append({"turns": turns, "check": check, "where": f"{path.name}#{len(examples) + 1}"})
            turns, check = [], True
    if turns or prompts:
        raise ValueError(f"{path.name}: the last example has no <<<END>>>")
    return examples


def programs(example):
    """The programs to run: the main pygame/VPython block of each answer."""
    if not example["check"]:
        return []
    out = []
    for _, answer in example["turns"]:
        code = main_program(answer)
        if code is not None and kind_of(code) != "python":
            out.append(code)
    return out


def run_checks(examples):
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    jobs = []
    for ex in examples:
        for code in programs(ex):
            key = hashlib.sha1(code.encode()).hexdigest()
            jobs.append((ex["where"], code, key))
    todo = [j for j in jobs if not cache.get(j[2], {}).get("ok")]
    print(f"{len(jobs)} programs, {len(todo)} to run ({len(jobs) - len(todo)} unchanged and passed before)")
    with ThreadPoolExecutor(4) as pool:
        for (where, code, key), res in zip(todo, pool.map(lambda j: check_code(j[1]), todo)):
            cache[key] = res
            if not res["ok"]:
                line = f" (line {res['error_line']}: {res['detail']})" if res.get("error_line") else ""
                print(f"  FAIL {where}: {res['error']}{line}")
    CACHE.parent.mkdir(exist_ok=True)
    CACHE.write_text(json.dumps(cache), encoding="utf-8")
    return [where for where, _, key in jobs if not cache[key]["ok"]]


def words(text):
    return set(re.findall(r"[a-z]+", text.lower())) - {"a", "an", "the", "in", "with", "and", "that", "to", "of", "i", "me", "my", "make", "write", "create", "program", "using", "use", "it", "on", "is", "can"}


def leak_warnings(examples):
    tests = [json.loads(line) for line in (HERE / "data" / "eval_prompts.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    for ex in examples:
        for prompts, _ in ex["turns"]:
            for p in prompts:
                pw = words(p)
                for t in tests:
                    tw = words(t["prompt"])
                    overlap = len(pw & tw) / max(1, len(pw | tw))
                    if overlap >= 0.5:
                        print(f"  warning: {ex['where']} looks like test task {t['id']} ({overlap:.0%} same words)")


def rows(examples, rng):
    start = datetime(2026, 1, 1, 8, 0)
    for ex in examples:
        turns = ex["turns"]
        variants = turns[0][0] if len(turns) == 1 else [turns[0][0][0]]
        for prompt in variants:
            messages = []
            if rng.random() < SYSTEM_SHARE:
                when = start + timedelta(minutes=rng.randrange(365 * 24 * 60))
                messages.append({"role": "system", "content": nexa_system_prompt(when=when)})
            for i, (prompts, answer) in enumerate(turns):
                messages.append({"role": "user", "content": prompt if i == 0 else prompts[0]})
                messages.append({"role": "assistant", "content": answer})
            yield {"messages": messages, "source": ex["where"]}


def main():
    files = sorted(EXAMPLES.glob("*.txt"))
    examples = [ex for f in files for ex in parse(f)]
    print(f"{len(examples)} examples in {len(files)} files")
    leak_warnings(examples)
    failed = run_checks(examples)
    if failed:
        print(f"\nStopped: {len(failed)} program(s) failed. Fix them and run again.")
        sys.exit(1)
    rng = random.Random(1234)
    data = list(rows(examples, rng))
    rng.shuffle(data)
    n_valid = max(1, int(len(data) * VALID_SHARE))
    for name, part in (("valid", data[:n_valid]), ("train", data[n_valid:])):
        with (HERE / "data" / f"{name}.jsonl").open("w", encoding="utf-8") as f:
            for r in part:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"wrote {len(data) - n_valid} training rows and {n_valid} validation rows")


if __name__ == "__main__":
    main()
