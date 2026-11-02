"""Finds the tested example closest to a question, so the model can see working code.

    from retrieval import ExampleIndex
    index = ExampleIndex()
    example = index.best("Make a pong game in pygame")  # None if the question isn't about pygame/VPython

Small models are much better at adapting a working program than writing one from scratch,
so showing one similar, already-tested example at answer time helps them use the right
functions. The examples come from data/examples/*.txt (only single-turn ones whose program
passed the checker), and similarity is plain TF-IDF over words, so it needs nothing extra.
"""

import math
import re
from collections import Counter

from build_dataset import EXAMPLES, parse
from check import kind_of, main_program

STOP = set("""a an the and or but if then else in on at to of for with without from by as is are be been
was were it its this that these those i me my you your we our they them their can could would should
will just make makes made write create show using use want how what why when where which who do does
did get got have has had not no so too very also into than like all any some one two each every more
most other only same such own program code python game simple please now let lets
pygame vpython visual""".split())  # the library picks which examples to search, so it can't tell them apart


SUFFIXES = [("ically", "ic"), ("ations", "at"), ("ation", "at"), ("ators", "at"), ("ator", "at"), ("ally", ""),
            ("ision", "id"), ("ing", ""), ("ies", "y"), ("ed", ""), ("es", ""), ("ly", ""), ("s", ""), ("e", "")]
ANSWER_WEIGHT = 0.3  # how much the example's answer counts next to its request when matching
MIN_SCORE = 0.12     # below this no example is close enough to be worth showing


def stem(word):
    """Crude stemming so 'balls'/'ball' and 'colliding'/'collision' match."""
    for suffix, repl in SUFFIXES:
        if suffix == "s" and word.endswith("ss"):
            continue  # "mass", "glass": the s is part of the word
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            return word[: -len(suffix)] + repl
    return word


def words(text):
    return [stem(w) for w in re.findall(r"[a-z]+", text.lower()) if len(w) > 2 and w not in STOP]


def request_text(prompt):
    """A prompt without the code someone pasted into it, which would drown out the request."""
    prompt = re.sub(r"```.*?```", " ", prompt, flags=re.S)
    looks_like_code = re.compile(r"^\s{2,}|^\s*(import|from|for|while|if|elif|else|def|class|return|print)\b"
                                 r"|=|\w\.\w+\(|:\s*$")
    return " ".join(line for line in prompt.splitlines() if not looks_like_code.search(line))


def library(question):
    q = question.lower()
    if "vpython" in q or "visual python" in q:
        return "vpython"
    if "pygame" in q:
        return "pygame"
    return None


class ExampleIndex:
    def __init__(self, folder=EXAMPLES):
        self.items = []
        for path in sorted(folder.glob("*.txt")):
            for ex in parse(path):
                if len(ex["turns"]) != 1 or not ex["check"]:
                    continue
                prompts, answer = ex["turns"][0]
                code = main_program(answer)
                if code is None or kind_of(code) == "python":
                    continue
                request = " ".join(request_text(p) for p in prompts)
                self.items.append({"kind": kind_of(code), "prompt": prompts[0], "answer": answer, "code": code,
                                   "where": ex["where"], "request_counts": Counter(set(words(request))),
                                   "answer_counts": Counter(words(answer))})
        df = Counter(w for item in self.items for w in set(item["request_counts"]) | set(item["answer_counts"]))
        n = len(self.items)
        self.idf = {w: math.log((1 + n) / (1 + c)) + 1 for w, c in df.items()}
        for item in self.items:
            item["request_vec"] = self._vector(item["request_counts"])
            item["answer_vec"] = self._vector(item["answer_counts"])

    def _vector(self, counts):
        vec = {w: c * self.idf.get(w, 0.0) for w, c in counts.items()}
        return vec, math.sqrt(sum(v * v for v in vec.values())) or 1.0

    @staticmethod
    def _cosine(a, b):
        (avec, anorm), (bvec, bnorm) = a, b
        return sum(v * bvec.get(w, 0.0) for w, v in avec.items()) / (anorm * bnorm)

    def best(self, question):
        """The most similar example for the same library, or None.

        Mostly by how well the example's request matches the question; its answer only breaks
        ties, since a long answer would otherwise dilute a good match.
        """
        kind = library(question)
        if kind is None:
            return None
        q = self._vector(Counter(set(words(question))))  # each word once: repeating one shouldn't win the match
        scored = [(self._cosine(q, item["request_vec"]) + ANSWER_WEIGHT * self._cosine(q, item["answer_vec"]), item)
                  for item in self.items if item["kind"] == kind]
        score, item = max(scored, key=lambda s: s[0])
        if score < MIN_SCORE:
            return None  # nothing similar: an unrelated example would only mislead
        return {**item, "score": score}


def reference_note(example):
    """Text added under the user's question, like the web search notes in server.py."""
    lib = "VPython" if example["kind"] == "vpython" else "pygame"
    return (f"For reference, here is a tested, working {lib} program for a similar task. Use the same "
            f"correct {lib} functions and structure, but write a complete program for my request, "
            f"not this one.\n\n```python\n{example['code']}```")
