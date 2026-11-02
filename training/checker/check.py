"""Checks Python answers about pygame and VPython by running them.

    python checker/check.py program.py [more.py ...]

From code: ``check_answer(markdown_text)`` takes a model's whole answer, picks the main
program out of its ```python blocks and runs it in harness.py (headless pygame, or the
strict VPython stand-in). It returns a dict such as
``{"ok": False, "kind": "pygame", "error": "NameError: ...", "error_line": 12}``.

Model answers are run on this PC, so code that deletes files, runs commands or uses the
network is refused instead of run (see UNSAFE_*). It runs in an empty temporary folder.
"""

import ast
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).parent
HARNESS = HERE / "harness.py"
TIMEOUT = 45  # seconds; a VPython loop without rate() or a stuck pygame loop hits this

CODE_BLOCK = re.compile(r"```[ \t]*(python3?|py)?[ \t]*\r?\n(.*?)```", re.S | re.I)

UNSAFE_MODULES = {"subprocess", "shutil", "socket", "ctypes", "requests", "urllib", "http",
                  "ftplib", "smtplib", "winreg", "multiprocessing", "webbrowser", "pathlib"}
UNSAFE_OS_CALLS = {"system", "remove", "unlink", "rmdir", "removedirs", "rename", "replace", "kill",
                   "popen", "startfile", "execv", "execl", "spawnl", "spawnv", "chmod"}
UNSAFE_BUILTINS = {"eval", "exec", "compile", "__import__"}


def extract_code(text):
    """Every ```python (or untagged) block in a Markdown answer."""
    return [m.group(2) for m in CODE_BLOCK.finditer(text)]


def kind_of(code):
    """'vpython', 'pygame' or 'python', from the imports (old `visual` counts as vpython)."""
    try:
        tree = ast.parse(code)
    except SyntaxError:
        tree = None
    names = set()
    if tree is not None:
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names.update(a.name.split(".")[0] for a in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                names.add(node.module.split(".")[0])
    else:
        names.update(re.findall(r"^\s*(?:from|import)\s+(\w+)", code, re.M))
    if names & {"vpython", "visual"}:
        return "vpython"
    if "pygame" in names:
        return "pygame"
    return "python"


def main_program(text):
    """The block to run: the longest one that imports pygame or VPython, else the longest."""
    blocks = extract_code(text)
    if not blocks and re.search(r"^\s*(import|from)\s+(pygame|vpython)", text, re.M):
        blocks = [text]  # a bare program with no Markdown around it
    if not blocks:
        return None
    graphical = [b for b in blocks if kind_of(b) != "python"]
    return max(graphical or blocks, key=len)


def unsafe(code):
    """Why the code isn't safe to run here, or None."""
    tree = ast.parse(code)
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            mods = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ""]
            for m in mods:
                if m.split(".")[0] in UNSAFE_MODULES:
                    return f"imports {m}"
            if isinstance(node, ast.ImportFrom) and node.module == "os":
                bad = [a.name for a in node.names if a.name in UNSAFE_OS_CALLS or a.name == "*"]
                if bad:
                    return f"imports os.{bad[0]}"
        elif isinstance(node, ast.Call):
            f = node.func
            if isinstance(f, ast.Name) and f.id in UNSAFE_BUILTINS:
                return f"calls {f.id}()"
            # os.remove(...) and friends; list.remove() and similar methods are fine
            if (isinstance(f, ast.Attribute) and f.attr in UNSAFE_OS_CALLS
                    and isinstance(f.value, ast.Name) and f.value.id == "os"):
                return f"calls os.{f.attr}()"
            if isinstance(f, ast.Name) and f.id == "open":
                mode = node.args[1] if len(node.args) > 1 else next((k.value for k in node.keywords if k.arg == "mode"), None)
                if mode is not None and not (isinstance(mode, ast.Constant) and set(str(mode.value)) <= set("rbt")):
                    return "opens a file for writing"
    return None


def check_code(code, timeout=TIMEOUT):
    """Runs one program in the harness and returns the result dict."""
    kind = kind_of(code)
    base = {"ok": False, "kind": kind, "frames": 0, "quit_ok": None, "error": None, "error_line": None, "detail": "",
            "draws": False, "distinct_frames": 0}
    try:
        compile(code, "<answer>", "exec")
    except SyntaxError as e:
        return {**base, "error": f"SyntaxError: {e.msg}", "error_line": e.lineno}
    why = unsafe(code)
    if why:
        return {**base, "error": f"not run: the code {why}", "unsafe": True}
    with tempfile.TemporaryDirectory(prefix="check_") as tmp:
        script = Path(tmp) / "program.py"
        script.write_text(code, encoding="utf-8")
        out = Path(tmp) / "result.json"
        env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1"}
        try:
            proc = subprocess.run(
                [sys.executable, str(HARNESS), kind, str(script), str(out)],
                cwd=tmp, env=env, input="3\n" * 50, capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            hint = "a loop without rate()" if kind == "vpython" else "a loop that never ends or blocks"
            return {**base, "error": f"timed out after {timeout}s (probably {hint})"}
        if not out.exists():
            tail = (proc.stderr or "").strip().splitlines()[-3:]
            return {**base, "error": "the harness crashed: " + " | ".join(tail)}
        return json.loads(out.read_text(encoding="utf-8"))


def works(result, static=False):
    """Stricter than ok: the program runs, shows something, and changes over time.

    "Runs without errors" alone lets through programs that draw nothing or never move.
    Pass static=True for tasks whose answer is a still picture (a chessboard, field arrows).
    This still can't tell whether the program does exactly what was asked.
    """
    if not result.get("ok"):
        return False
    if static:
        return bool(result.get("draws"))
    # The harness skips the first few frames, so 2+ different frames means something really moves
    return result.get("distinct_frames", 0) >= 2


def check_answer(text, timeout=TIMEOUT):
    """Checks a whole Markdown answer. {"ok": False, "error": "no code"} if it has none."""
    code = main_program(text)
    if code is None:
        return {"ok": False, "kind": None, "error": "no code in the answer"}
    return {**check_code(code, timeout), "code": code}


if __name__ == "__main__":
    failed = 0
    for path in sys.argv[1:]:
        r = check_code(Path(path).read_text(encoding="utf-8"))
        mark = "PASS" if r["ok"] else "FAIL"
        failed += not r["ok"]
        where = f" (line {r['error_line']}: {r['detail']})" if r.get("error_line") else ""
        shows = f", {'draws' if r.get('draws') else 'draws nothing'}, {r.get('distinct_frames', 0)} different frames"
        print(f"{mark} {path} [{r['kind']}, {r['frames']} frames{shows}]" + (f": {r['error']}{where}" if r["error"] else ""))
    sys.exit(1 if failed else 0)
