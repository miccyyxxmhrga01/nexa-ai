"""Merges the trained LoRA adapter into Gemma and adds the result to Ollama.

    python export.py                         # creates the Ollama model "nexa-coder"
    python export.py --adapter out/lora_epoch2 --name nexa-coder-e2

Steps: merge the adapter into the model (out/merged, about 2 GB), convert it to an 8-bit
GGUF file with llama.cpp's converter (out/nexa-coder-q8_0.gguf, about 1.1 GB), then
`ollama create` from that file. The big temporary files are deleted afterwards unless you
pass --keep-files. Your gemma3:1b model isn't changed.

GGUF is used because this Ollama version can't import Gemma 3 safetensors directly (its
safetensors import needs the MLX runtime, which isn't available on this PC). The converter
lives in tools/llama.cpp-*/ (downloaded once, with its `gguf` package in this .venv).
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM

HERE = Path(__file__).parent
OUT = HERE / "out"

# Ollama's own gemma3 template (from `ollama show gemma3:1b --modelfile`); train.py
# lays out the training chats the same way.
TEMPLATE = '''{{- range $i, $_ := .Messages }}
{{- $last := eq (len (slice $.Messages $i)) 1 }}
{{- if or (eq .Role "user") (eq .Role "system") }}<start_of_turn>user
{{ .Content }}<end_of_turn>
{{ if $last }}<start_of_turn>model
{{ end }}
{{- else if eq .Role "assistant" }}<start_of_turn>model
{{ .Content }}{{ if not $last }}<end_of_turn>
{{ end }}
{{- end }}
{{- end }}'''

MODELFILE = '''FROM ./{gguf}
TEMPLATE """{template}"""
PARAMETER stop <end_of_turn>
PARAMETER temperature 0.4
PARAMETER top_p 0.95
PARAMETER top_k 64
PARAMETER num_ctx 4096
LICENSE """Gemma is provided under and subject to the Gemma Terms of Use found at ai.google.dev/gemma/terms.
This model is a modified version of Gemma 3 1B (instruction-tuned), fine-tuned with LoRA on
pygame and VPython coding examples for the Nexa assistant. Use of it is subject to the Gemma
Prohibited Use Policy at ai.google.dev/gemma/prohibited_use_policy."""
'''

TOKENIZER_FILES = ["tokenizer.json", "tokenizer.model", "tokenizer_config.json", "special_tokens_map.json",
                   "added_tokens.json", "chat_template.jinja", "generation_config.json"]


def find_converter():
    found = sorted((HERE / "tools").glob("llama.cpp-*/convert_hf_to_gguf.py"))
    if not found:
        sys.exit("llama.cpp's converter isn't in tools/. See README.md (Export) for how to get it.")
    return found[-1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=str(HERE / "models" / "gemma-3-1b-it"))
    ap.add_argument("--adapter", default=str(OUT / "lora"))
    ap.add_argument("--name", default="nexa-coder")
    ap.add_argument("--precision", default="q8_0", choices=["q8_0", "f16", "bf16"],
                    help="q8_0 = 8-bit (about 1.1 GB); f16/bf16 = 16-bit (about 2 GB)")
    ap.add_argument("--keep-files", action="store_true", help="keep out/merged and the .gguf file")
    args = ap.parse_args()
    converter = find_converter()

    merged = OUT / "merged"
    print(f"Merging {args.adapter} into the model...", flush=True)
    model = AutoModelForCausalLM.from_pretrained(args.base, dtype=torch.float32)
    model = PeftModel.from_pretrained(model, args.adapter).merge_and_unload()
    model.to(torch.bfloat16).save_pretrained(merged, safe_serialization=True)
    del model
    for name in TOKENIZER_FILES:
        src = Path(args.base) / name
        if src.exists():
            shutil.copy(src, merged / name)

    gguf = OUT / f"{args.name}-{args.precision}.gguf"
    print(f"Converting to {gguf.name}...", flush=True)
    subprocess.run([sys.executable, str(converter), str(merged), "--outtype", args.precision,
                    "--outfile", str(gguf)], check=True)

    modelfile = OUT / "Modelfile"
    modelfile.write_text(MODELFILE.format(gguf=gguf.name, template=TEMPLATE), encoding="utf-8")
    print(f"Running: ollama create {args.name}", flush=True)
    subprocess.run(["ollama", "create", args.name, "-f", str(modelfile)], check=True, cwd=OUT)
    if not args.keep_files:
        shutil.rmtree(merged)
        gguf.unlink()  # Ollama keeps its own copy
    print(f"Done. Try it:  ollama run {args.name}")


if __name__ == "__main__":
    main()
