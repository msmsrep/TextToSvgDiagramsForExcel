"""Teaches a small model to turn Japanese text into Mermaid (LoRA), then merges it.

    python train.py --base desktop/out/hf/Qwen3.5-0.8B --data desktop/out/train-data/claude.jsonl --out desktop/out/mermaid-0.8b

The model sees only the text (sometimes followed by the diagram type the app asks
for, as in MermaidPrompt.cs) and learns to answer with one ```mermaid block. No
instructions or examples are given, so the app sends the tuned model the short
conversation (MermaidPrompt.TunedMessages).

<out>/adapter is the LoRA adapter, <out>/merged the base model with it merged in,
ready for the ONNX Runtime GenAI model builder (see README.md), and <out>/log.json
the losses. Everything runs on this PC.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from pathlib import Path

import torch
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer, get_cosine_schedule_with_warmup

# The hint the app adds when the user picks a diagram type (MermaidPrompt.Messages).
HINT = {"flowchart": "flowchart", "sequence": "sequenceDiagram", "gantt": "gantt chart"}


def conversation(text: str, kind: str | None) -> list[dict]:
    request = f"{text}\n\n(Use a {HINT[kind]}.)" if kind else text
    return [{"role": "user", "content": request}]


def answer(code: str) -> str:
    return f"```mermaid\n{code}\n```"


def encode(tokenizer, record: dict, hinted: bool, max_len: int) -> dict | None:
    prompt = tokenizer.apply_chat_template(conversation(record["text"], record["type"] if hinted else None),
                                           tokenize=False, add_generation_prompt=True, enable_thinking=False)
    prompt_ids = tokenizer(prompt, add_special_tokens=False)["input_ids"]
    answer_ids = tokenizer(answer(record["code"]) + "<|im_end|>\n", add_special_tokens=False)["input_ids"]
    ids = prompt_ids + answer_ids
    if len(ids) > max_len:
        return None
    return {"input_ids": ids, "labels": [-100] * len(prompt_ids) + answer_ids}


def batches(items: list[dict], size: int, pad_id: int, rng: random.Random | None):
    order = list(range(len(items)))
    if rng:
        rng.shuffle(order)
    for start in range(0, len(order), size):
        chunk = [items[i] for i in order[start:start + size]]
        width = max(len(c["input_ids"]) for c in chunk)
        ids = torch.full((len(chunk), width), pad_id)
        labels = torch.full((len(chunk), width), -100)
        mask = torch.zeros((len(chunk), width), dtype=torch.long)
        for row, c in enumerate(chunk):
            n = len(c["input_ids"])
            ids[row, :n] = torch.tensor(c["input_ids"])
            labels[row, :n] = torch.tensor(c["labels"])
            mask[row, :n] = 1
        yield ids, labels, mask


def evaluate(model, items, size, pad_id, device) -> float:
    model.eval()
    total, count = 0.0, 0
    with torch.no_grad():
        for ids, labels, mask in batches(items, size, pad_id, None):
            out = model(input_ids=ids.to(device), attention_mask=mask.to(device), labels=labels.to(device))
            tokens = int((labels[:, 1:] != -100).sum())
            total += float(out.loss) * tokens
            count += tokens
    model.train()
    return total / max(count, 1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", required=True, help="Hugging Face model folder")
    parser.add_argument("--data", nargs="+", required=True, help="JSONL files of {type, text, code}")
    parser.add_argument("--out", required=True)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--lr", type=float, default=2e-4)
    parser.add_argument("--rank", type=int, default=16)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--grad-accum", type=int, default=2)
    parser.add_argument("--max-len", type=int, default=1024, help="longer pairs (in tokens) are skipped")
    parser.add_argument("--hint-rate", type=float, default=0.3, help="share of pairs shown with the diagram type")
    parser.add_argument("--val", type=float, default=0.05, help="share of pairs kept aside to measure the loss")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--max-steps", type=int, default=0, help="stop after this many optimizer steps (0: no limit), for a quick check")
    args = parser.parse_args()

    rng = random.Random(args.seed)
    torch.manual_seed(args.seed)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    records = []
    for path in args.data:
        records += [json.loads(l) for l in Path(path).read_text(encoding="utf-8").splitlines() if l.strip()]
    records = [r for r in records if r.get("type") in HINT]
    rng.shuffle(records)
    n_val = max(1, int(len(records) * args.val))
    val_records, train_records = records[:n_val], records[n_val:]

    tokenizer = AutoTokenizer.from_pretrained(args.base)
    pad_id = tokenizer.pad_token_id if tokenizer.pad_token_id is not None else tokenizer.eos_token_id
    train = [e for r in train_records if (e := encode(tokenizer, r, rng.random() < args.hint_rate, args.max_len))]
    val = [e for r in val_records if (e := encode(tokenizer, r, False, args.max_len))]
    print(f"{len(train)} pairs to learn, {len(val)} to measure ({len(records) - len(train) - len(val)} too long)", file=sys.stderr)

    dtype = torch.bfloat16 if args.device == "cuda" else torch.float32
    model = AutoModelForCausalLM.from_pretrained(args.base, dtype=dtype).to(args.device)
    model.gradient_checkpointing_enable()
    model.enable_input_require_grads()
    model = get_peft_model(model, LoraConfig(r=args.rank, lora_alpha=args.rank * 2, lora_dropout=0.05,
                                             target_modules="all-linear", task_type="CAUSAL_LM"))
    model.print_trainable_parameters()

    steps_per_epoch = math.ceil(len(train) / args.batch / args.grad_accum)
    total_steps = steps_per_epoch * args.epochs
    if args.max_steps:
        total_steps = min(total_steps, args.max_steps)
    optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=args.lr, weight_decay=0.0)
    schedule = get_cosine_schedule_with_warmup(optimizer, max(1, total_steps // 20), total_steps)

    log = {"args": vars(args), "train": len(train), "val": len(val), "epochs": []}
    step, started = 0, time.time()
    model.train()
    log["epochs"].append({"epoch": 0, "val_loss": round(evaluate(model, val, args.batch, pad_id, args.device), 4)})
    print(f"before training: val loss {log['epochs'][0]['val_loss']}", file=sys.stderr)
    for epoch in range(1, args.epochs + 1):
        running, seen = 0.0, 0
        for i, (ids, labels, mask) in enumerate(batches(train, args.batch, pad_id, rng)):
            out_ = model(input_ids=ids.to(args.device), attention_mask=mask.to(args.device), labels=labels.to(args.device))
            (out_.loss / args.grad_accum).backward()
            running += float(out_.loss.detach())
            seen += 1
            if (i + 1) % args.grad_accum == 0:
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimizer.step()
                schedule.step()
                optimizer.zero_grad()
                step += 1
                if step % 10 == 0:
                    print(f"epoch {epoch} step {step}/{total_steps} loss {running / seen:.4f} "
                          f"({(time.time() - started) / step:.1f}s/step)", file=sys.stderr)
                if step >= total_steps:
                    break
        val_loss = evaluate(model, val, args.batch, pad_id, args.device)
        log["epochs"].append({"epoch": epoch, "train_loss": round(running / max(seen, 1), 4), "val_loss": round(val_loss, 4)})
        print(f"epoch {epoch}: train loss {running / max(seen, 1):.4f}, val loss {val_loss:.4f}", file=sys.stderr)
        if step >= total_steps:
            break

    model.save_pretrained(out / "adapter")
    merged = model.merge_and_unload()
    merged.save_pretrained(out / "merged", safe_serialization=True)
    tokenizer.save_pretrained(out / "merged")
    log["seconds"] = round(time.time() - started)
    (out / "log.json").write_text(json.dumps(log, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved to {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
