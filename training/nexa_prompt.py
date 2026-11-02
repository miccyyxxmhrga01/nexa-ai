"""Nexa's system prompt, read from server.py so training and testing match what Nexa sends."""

import ast
from datetime import datetime
from pathlib import Path

SERVER = Path(__file__).resolve().parent.parent / "server.py"


def _constants():
    tree = ast.parse(SERVER.read_text(encoding="utf-8"))
    env = {}
    for node in tree.body:
        if (isinstance(node, ast.Assign) and len(node.targets) == 1
                and isinstance(node.targets[0], ast.Name)
                and node.targets[0].id in ("MAKER", "SYSTEM_PROMPT")):
            env[node.targets[0].id] = eval(compile(ast.Expression(node.value), str(SERVER), "eval"), {}, env)
    return env


def nexa_system_prompt(when=None, address=""):
    """The system message /api/chat in server.py builds (keep in step with it)."""
    c = _constants()
    address_rule = (
        f" Address the user as '{address}' (for example 'Yes, {address}.'), at most once per reply."
        if address else " Do not call the user by any title or name."
    )
    now = (when or datetime.now()).strftime("%A, %B %d, %Y, %I:%M %p")
    return f"{c['SYSTEM_PROMPT']}{address_rule} The current local date and time is {now}."
