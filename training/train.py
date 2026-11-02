"""LoRA fine-tune of Gemma 3 1B on data/train.jsonl, on the CPU.

    python train.py --epochs 3       # the real run (about an hour per epoch on a 4-core laptop CPU)
    python train.py --limit 4 --epochs 1 --accum 2   # a quick test of the whole pipeline

Only small LoRA matrices are trained (about 1% of the weights); the model itself stays
frozen. Chats are laid out exactly as Ollama's gemma3 template sends them, and the loss
is computed on Nexa's answers only, never on the prompts. The adapter is saved to
out/lora after every epoch, and also when you stop with Ctrl+C.
"""

import argparse
import json
import math
import random
import time
from datetime import datetime
from pathlib import Path

import torch
import torch.nn.functional as F
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer

HERE = Path(__file__).parent


def render(tok, messages, max_len):
    """Token ids and labels for one chat, in Ollama's gemma3 template. Labels are -100 on prompts."""
    pieces = [("<bos>", False)]
    for m in messages:
        if m["role"] in ("system", "user"):
            pieces.append((f"<start_of_turn>user\n{m['content']}<end_of_turn>\n", False))
        else:
            pieces.append(("<start_of_turn>model\n", False))
            pieces.append((m["content"] + "<end_of_turn>\n", True))
    ids, labels = [], []
    for text, train in pieces:
        t = tok(text, add_special_tokens=False)["input_ids"]
        ids += t
        labels += t if train else [-100] * len(t)
    return (ids, labels) if len(ids) <= max_len else None


def load(path, tok, max_len, limit=None):
    rows = [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]
    if limit:
        rows = rows[:limit]
    out, dropped = [], 0
    for r in rows:
        item = render(tok, r["messages"], max_len)
        if item is None:
            dropped += 1
        else:
            out.append(item)
    if dropped:
        print(f"  {dropped} rows longer than {max_len} tokens were left out")
    return out


def loss_on(model, ids, labels):
    """Mean loss over answer tokens; logits are only computed where there is a target."""
    x = torch.tensor([ids])
    y = torch.tensor(labels)
    keep = (y[1:] != -100).nonzero().squeeze(1)  # positions whose next token is trained
    logits = model(input_ids=x, logits_to_keep=keep).logits[0]
    return F.cross_entropy(logits.float(), y[keep + 1]), len(keep)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=str(HERE / "models" / "gemma-3-1b-it"))
    ap.add_argument("--data", default=str(HERE / "data" / "train.jsonl"))
    ap.add_argument("--valid", default=str(HERE / "data" / "valid.jsonl"))
    ap.add_argument("--out", default=str(HERE / "out" / "lora"))
    ap.add_argument("--epochs", type=int, default=2)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--accum", type=int, default=8, help="chats per optimizer step")
    ap.add_argument("--max-len", type=int, default=2048)
    ap.add_argument("--limit", type=int, help="use only the first N rows (for testing)")
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--checkpointing", action="store_true", help="less memory, about 30%% slower")
    ap.add_argument("--dtype", choices=["float32", "bfloat16"], default="float32",
                    help="bfloat16 halves the memory of the frozen model (the LoRA part stays float32)")
    args = ap.parse_args()

    torch.set_num_threads(args.threads)
    torch.manual_seed(0)
    tok = AutoTokenizer.from_pretrained(args.base)
    train = load(args.data, tok, args.max_len, args.limit)
    valid = load(args.valid, tok, args.max_len, args.limit) if Path(args.valid).exists() else []
    tokens = sum(len(i) for i, _ in train)
    print(f"{len(train)} training chats ({tokens} tokens), {len(valid)} validation chats")

    model = AutoModelForCausalLM.from_pretrained(args.base, dtype=getattr(torch, args.dtype), attn_implementation="sdpa")
    model.config.use_cache = False
    if args.checkpointing:
        model.gradient_checkpointing_enable()
        model.enable_input_require_grads()
    model = get_peft_model(model, LoraConfig(
        r=args.rank, lora_alpha=2 * args.rank, lora_dropout=0.05, task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    ))
    model.print_trainable_parameters()

    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=args.lr, weight_decay=0.0)
    total_steps = math.ceil(len(train) / args.accum) * args.epochs
    warmup = max(1, total_steps // 10)

    def lr_at(step):
        if step < warmup:
            return args.lr * (step + 1) / warmup
        progress = (step - warmup) / max(1, total_steps - warmup)
        return args.lr * (0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * progress)))

    log = (HERE / "out" / "train_log.jsonl")
    log.parent.mkdir(exist_ok=True)
    out = Path(args.out)

    def save(note, folder=out):
        model.save_pretrained(folder)
        tok.save_pretrained(folder)
        print(f"  saved the adapter to {folder} ({note})", flush=True)

    def validate():
        if not valid:
            return None
        model.eval()
        with torch.no_grad():
            total, n = 0.0, 0
            for ids, labels in valid:
                loss, k = loss_on(model, ids, labels)
                total, n = total + loss.item() * k, n + k
        model.train()
        return total / n

    print(f"{total_steps} optimizer steps over {args.epochs} epoch(s); validation loss before training: {validate()}", flush=True)
    model.train()
    step, done_tokens, started = 0, 0, time.time()
    rng = random.Random(0)
    try:
        for epoch in range(args.epochs):
            order = list(range(len(train)))
            rng.shuffle(order)
            for start in range(0, len(order), args.accum):
                batch = [train[i] for i in order[start:start + args.accum]]
                for g in opt.param_groups:
                    g["lr"] = lr_at(step)
                batch_loss = 0.0
                for ids, labels in batch:
                    loss, _ = loss_on(model, ids, labels)
                    (loss / len(batch)).backward()
                    batch_loss += loss.item() / len(batch)
                    done_tokens += len(ids)
                torch.nn.utils.clip_grad_norm_(params, 1.0)
                opt.step()
                opt.zero_grad(set_to_none=True)
                step += 1
                elapsed = time.time() - started
                speed = done_tokens / elapsed
                eta = (tokens * args.epochs - done_tokens) / speed
                print(f"epoch {epoch + 1} step {step}/{total_steps}  loss {batch_loss:.3f}  "
                      f"{speed:.0f} tokens/s  about {eta / 60:.0f} min left", flush=True)
                with log.open("a", encoding="utf-8") as f:
                    f.write(json.dumps({"step": step, "epoch": epoch + 1, "loss": round(batch_loss, 4),
                                        "lr": lr_at(step - 1), "tokens_per_s": round(speed, 1),
                                        "time": datetime.now().isoformat(timespec="seconds")}) + "\n")
            v = validate()
            print(f"end of epoch {epoch + 1}: validation loss {v}", flush=True)
            # Each epoch gets its own copy, so an earlier one can be used if a later one overfits
            save(f"epoch {epoch + 1}", out.with_name(f"{out.name}_epoch{epoch + 1}"))
            save(f"latest, epoch {epoch + 1}")
    except KeyboardInterrupt:
        print("\nStopped early.")
        save(f"stopped at step {step}")
    print(f"done in {(time.time() - started) / 60:.0f} min")


if __name__ == "__main__":
    main()
