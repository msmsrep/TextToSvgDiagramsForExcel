"""Makes a copy of a base model that keeps only the tokens Japanese and English need.

    python prune_vocab.py --base desktop/out/hf/Qwen3.5-0.8B --out desktop/out/hf/Qwen3.5-0.8B-jaen
        --corpus desktop/out/corpus/wikipedia/20231101.ja/train-00002-of-00015.parquet
                 desktop/out/corpus/wikipedia/20231101.en/train-00002-of-00041.parquet
        --always desktop/out/train-data/claude.jsonl desktop/out/train-data/qwen4b/filtered.jsonl

The base model has 248,320 tokens for every language, and the table for them is the
largest part of the int4 model. This keeps the most used ones (--size, 40,000 by
default) and drops the rest, together with the merge rules that make them. Text that
used a dropped token is then split into smaller kept tokens (down to single bytes), so
everything can still be read and written; it only takes more tokens.

Kept: every token no merge makes (the bytes), every single character Japanese
(cp932) or ASCII can write, the tokens of the --always files (the training pairs),
then the most frequent tokens of the --corpus files (each file weighs the same), each
with the tokens it is merged from. The special tokens keep their order after them.

The result is a model folder in the same layout as the base (the embedding rows, the
tokenizer and the token ids in the configs are renumbered), so train.py and export.py
take it as --base. A model trained on the full vocabulary cannot use this tokenizer:
train again. Everything runs on this PC.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import numpy as np
import torch
from safetensors import safe_open
from safetensors.torch import save_file
from tokenizers import Tokenizer

INFO = "pruned-vocab.json"

# What surrounds every request and answer (the chat template, train.py's hints and code block).
FRAME = ("<|im_start|>system\n<|im_end|>\n<|im_start|>user\n<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
         "```mermaid\nflowchart TD\n```<|im_end|>\n```mermaid\nsequenceDiagram\n```\n```mermaid\ngantt\n```\n"
         "x\n\n(Use a flowchart.)\nx\n\n(Use a sequenceDiagram.)\nx\n\n(Use a gantt chart.)")


def texts(path: Path, max_chars: int, skip_chars: int = 0):
    """Chunks of text from a .parquet (column "text"), .jsonl ({text, code}) or plain text file."""
    seen = 0

    def take(text: str):
        nonlocal seen
        for start in range(0, len(text), 2000):
            piece = text[start:start + 2000]
            seen += len(piece)
            if seen > skip_chars:
                yield piece
            if seen >= skip_chars + max_chars:
                return

    if path.suffix == ".parquet":
        import pyarrow.parquet as pq
        for batch in pq.ParquetFile(path).iter_batches(batch_size=200, columns=["text"]):
            for text in batch.column(0).to_pylist():
                yield from take(text or "")
                if seen >= skip_chars + max_chars:
                    return
    elif path.suffix == ".jsonl":
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                record = json.loads(line)
                yield from take(record.get("text", "") + "\n" + record.get("code", ""))
    else:
        yield from take(path.read_text(encoding="utf-8"))


def count(tokenizer: Tokenizer, chunks, size: int) -> np.ndarray:
    counts = np.zeros(size, dtype=np.int64)
    batch = []

    def flush():
        for enc in tokenizer.encode_batch(batch, add_special_tokens=False):
            counts[:] += np.bincount(enc.ids, minlength=size)
        batch.clear()

    for chunk in chunks:
        batch.append(chunk)
        if len(batch) == 512:
            flush()
    if batch:
        flush()
    return counts


def single_char(token_bytes: bytes) -> bool:
    """One character that ASCII or Japanese (cp932) can write."""
    try:
        text = token_bytes.decode("utf-8")
    except UnicodeDecodeError:
        return False
    if len(text.lstrip(" ")) != 1 or len(text) > 2:
        return False
    try:
        text.encode("cp932")
    except UnicodeEncodeError:
        return False
    return True


def byte_alphabet() -> dict[str, int]:
    """The character the byte-level tokenizer writes each byte as (the GPT-2 table)."""
    visible = list(range(ord("!"), ord("~") + 1)) + list(range(0xA1, 0xAD)) + list(range(0xAE, 0x100))
    table = {chr(b): b for b in visible}
    extra = 0
    for b in range(256):
        if b not in visible:
            table[chr(256 + extra)] = b
            extra += 1
    return table


def remap_ids(value, key: str, new_id):
    """Renumbers the token ids in a config (keys ending in token_id / token_ids)."""
    if isinstance(value, dict):
        return {k: remap_ids(v, k, new_id) for k, v in value.items()}
    if key.endswith("token_id") and isinstance(value, int):
        return new_id(value)
    if key.endswith("token_id") or key.endswith("token_ids"):
        if isinstance(value, list) and all(isinstance(v, int) for v in value):
            return [new_id(v) for v in value]
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", required=True, help="Hugging Face model folder")
    parser.add_argument("--out", required=True, help="the model folder to make")
    parser.add_argument("--corpus", nargs="+", required=True, help="text to count tokens in (.parquet / .jsonl / .txt)")
    parser.add_argument("--always", nargs="*", default=[], help="files whose tokens are all kept")
    parser.add_argument("--size", type=int, default=40000, help="tokens to keep, the special ones included")
    parser.add_argument("--chars", type=int, default=50_000_000, help="characters to read from each corpus file")
    parser.add_argument("--check-chars", type=int, default=2_000_000, help="characters after those, to measure the result on")
    args = parser.parse_args()

    base, out = Path(args.base), Path(args.out)
    spec = json.loads((base / "tokenizer.json").read_text(encoding="utf-8"))
    model = spec["model"]
    vocab: dict[str, int] = model["vocab"]
    merges = [tuple(m.split(" ")) if isinstance(m, str) else tuple(m) for m in model["merges"]]
    n_plain = len(vocab)                      # ids below this are ordinary tokens; the rest are special
    if sorted(vocab.values()) != list(range(n_plain)):
        raise SystemExit("The vocabulary ids are not 0..n-1.")
    config = json.loads((base / "config.json").read_text(encoding="utf-8"))
    n_rows = config["text_config"]["vocab_size"]
    n_special = n_rows - n_plain
    n_keep = args.size - n_special
    token_of = {i: t for t, i in vocab.items()}

    parents: dict[int, tuple[int, int]] = {}
    for a, b in merges:
        parents.setdefault(vocab[a + b], (vocab[a], vocab[b]))

    old = Tokenizer.from_file(str(base / "tokenizer.json"))
    byte_of = byte_alphabet()

    def to_bytes(token: str) -> bytes:
        return bytes(byte_of[ch] for ch in token)

    keep: set[int] = set()

    def add(i: int) -> None:
        stack = [i]
        while stack:
            j = stack.pop()
            if j in keep:
                continue
            keep.add(j)
            stack.extend(parents.get(j, ()))

    for i in range(n_plain):
        if i not in parents or single_char(to_bytes(token_of[i])):
            add(i)
    forced_chars = len(keep)
    for path in args.always:
        for i in np.nonzero(count(old, texts(Path(path), 10**12), n_plain + n_special)[:n_plain])[0]:
            add(int(i))
    for i in old.encode(FRAME, add_special_tokens=False).ids:
        if i < n_plain:
            add(i)
    forced = len(keep)
    if forced > n_keep:
        raise SystemExit(f"--size is too small: {forced} tokens are always kept.")

    score = np.zeros(n_plain)
    for path in args.corpus:
        counts = count(old, texts(Path(path), args.chars), n_plain + n_special)[:n_plain]
        print(f"{path}: {int(counts.sum()):,} tokens, {int((counts > 0).sum()):,} different", file=sys.stderr)
        score += counts / max(counts.sum(), 1)
    for i in np.argsort(-score, kind="stable"):
        if len(keep) >= n_keep or score[i] == 0:
            break
        i = int(i)
        if i in keep:
            continue
        need = set()
        stack = [i]
        while stack:
            j = stack.pop()
            if j not in keep and j not in need:
                need.add(j)
                stack.extend(parents.get(j, ()))
        if len(keep) + len(need) <= n_keep:
            keep |= need
    kept = sorted(keep)
    new_plain = {o: n for n, o in enumerate(kept)}

    def new_id(o: int) -> int:
        return new_plain[o] if o < n_plain else len(kept) + (o - n_plain)

    rows = torch.tensor(kept + list(range(n_plain, n_rows)))
    n_new = len(rows)

    out.mkdir(parents=True, exist_ok=True)
    for f in base.iterdir():
        if f.is_file() and f.suffix in (".json", ".jinja", ".txt", ".md", "") and not f.name.startswith("model.safetensors") \
                and f.name not in ("tokenizer.json", "vocab.json", "merges.txt", "config.json", "tokenizer_config.json", ".gitattributes"):
            shutil.copy2(f, out / f.name)

    model["vocab"] = {token_of[o]: n for o, n in new_plain.items()}
    kept_merges = [(a, b) for a, b in merges if vocab[a + b] in keep and vocab[a] in keep and vocab[b] in keep]
    model["merges"] = [f"{a} {b}" for a, b in kept_merges] if isinstance(spec["model"]["merges"][0], str) else [list(m) for m in kept_merges]
    for token in spec["added_tokens"]:
        token["id"] = new_id(token["id"])
    (out / "tokenizer.json").write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
    (out / "vocab.json").write_text(json.dumps(model["vocab"], ensure_ascii=False), encoding="utf-8")
    (out / "merges.txt").write_text("#version: 0.2\n" + "".join(f"{a} {b}\n" for a, b in kept_merges), encoding="utf-8")

    tok_config = json.loads((base / "tokenizer_config.json").read_text(encoding="utf-8"))
    if "added_tokens_decoder" in tok_config:
        tok_config["added_tokens_decoder"] = {str(new_id(int(k))): v for k, v in tok_config["added_tokens_decoder"].items()}
    (out / "tokenizer_config.json").write_text(json.dumps(tok_config, ensure_ascii=False, indent=2), encoding="utf-8")

    config = remap_ids(config, "", new_id)
    config["text_config"]["vocab_size"] = n_new
    if "vocab_size" in config:
        config["vocab_size"] = n_new
    (out / "config.json").write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")

    tensors, resized = {}, []
    for shard in sorted(base.glob("*.safetensors")):
        with safe_open(shard, "pt") as f:
            for k in f.keys():
                t = f.get_tensor(k)
                if t.shape and t.shape[0] == n_rows:
                    t = t.index_select(0, rows).contiguous()
                    resized.append(k)
                tensors[k] = t
    if not resized:
        raise SystemExit("No weight has one row per token.")
    save_file(tensors, out / "model.safetensors", metadata={"format": "pt"})
    (out / "model.safetensors.index.json").write_text(
        json.dumps({"metadata": {}, "weight_map": {k: "model.safetensors" for k in tensors}}), encoding="utf-8")

    # How much longer does text get, and does it still come back the same?
    new = Tokenizer.from_file(str(out / "tokenizer.json"))
    measured = {}
    for path in list(args.corpus) + list(args.always):
        p = Path(path)
        chunks = list(texts(p, args.check_chars, args.chars if p in map(Path, args.corpus) else 0))
        a = b = 0
        for chunk, e_old, e_new in zip(chunks, old.encode_batch(chunks, add_special_tokens=False),
                                       new.encode_batch(chunks, add_special_tokens=False)):
            a += len(e_old.ids)
            b += len(e_new.ids)
            if new.decode(e_new.ids, skip_special_tokens=False) != old.decode(e_old.ids, skip_special_tokens=False):
                raise SystemExit(f"Text does not come back the same: {chunk[:80]!r}")
            if max(e_new.ids) >= n_new:
                raise SystemExit("A token id is out of range.")
        measured[str(path)] = {"tokens_before": a, "tokens_after": b, "ratio": round(b / max(a, 1), 4)}
        print(f"{path}: {a:,} -> {b:,} tokens (x{b / max(a, 1):.3f})", file=sys.stderr)

    info = {"base": base.name, "tokens_before": n_rows, "tokens_after": n_new, "plain": len(kept), "special": n_special,
            "always_single_characters_and_bytes": forced_chars, "always_from_files": forced - forced_chars,
            "merges": len(kept_merges), "resized": resized, "corpus": [str(p) for p in args.corpus],
            "chars_per_corpus": args.chars, "measured": measured}
    (out / INFO).write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{n_rows:,} -> {n_new:,} tokens ({forced_chars:,} bytes and characters, {forced - forced_chars:,} more from --always). "
          f"Saved to {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
