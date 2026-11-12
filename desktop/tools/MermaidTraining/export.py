"""Turns a trained model (train.py's <out>/merged) into an ONNX Runtime GenAI model folder.

    python export.py --base desktop/out/hf/Qwen3.5-0.8B --merged desktop/out/mermaid-0.8b/merged --out desktop/models/mermaid-0.8b

The model builder only reads Qwen3.5 in its original layout (the image-and-text
model), while train.py saves the text part. So the trained text weights are put back
into a copy of the base checkpoint (same weight names), then the builder makes an
int4 CPU model from the text part. The folder gets text-to-mermaid.json, which tells
the app to send the text alone (MermaidPrompt.TunedMarker).
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

from safetensors import safe_open
from safetensors.torch import save_file

MARKER = "text-to-mermaid.json"


def full_checkpoint(base: Path, merged: Path, folder: Path) -> None:
    """A copy of the base checkpoint with the language model's weights taken from merged."""
    folder.mkdir(parents=True, exist_ok=True)
    for f in base.iterdir():
        if f.is_file() and not f.name.startswith("model.safetensors") and f.suffix in (".json", ".jinja", ".txt"):
            shutil.copy2(f, folder / f.name)
    tensors = {}
    for shard in sorted(base.glob("*.safetensors")):
        with safe_open(shard, "pt") as f:
            tensors |= {k: f.get_tensor(k) for k in f.keys()}
    replaced = 0
    with safe_open(merged / "model.safetensors", "pt") as f:
        for k in f.keys():
            if k not in tensors:
                raise SystemExit(f"{k} is not in the base checkpoint: the names do not match.")
            tensors[k] = f.get_tensor(k).to(tensors[k].dtype)
            replaced += 1
    save_file(tensors, folder / "model.safetensors", metadata={"format": "pt"})
    index = folder / "model.safetensors.index.json"
    index.write_text(json.dumps({"metadata": {}, "weight_map": {k: "model.safetensors" for k in tensors}}), encoding="utf-8")
    print(f"{replaced} of {len(tensors)} tensors taken from the trained model", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", required=True)
    parser.add_argument("--merged", required=True)
    parser.add_argument("--out", required=True, help="the ONNX model folder to make")
    parser.add_argument("--work", help="where to put the full checkpoint (default: next to merged)")
    args = parser.parse_args()

    merged = Path(args.merged)
    work = Path(args.work) if args.work else merged.parent / "full"
    full_checkpoint(Path(args.base), merged, work)

    out = Path(args.out)
    subprocess.run([sys.executable, "-m", "onnxruntime_genai.models.builder", "-i", str(work), "-o", str(out),
                    "-p", "int4", "-e", "cpu", "-c", str(work.parent / "cache"),
                    "--extra_options", "int4_accuracy_level=4", "text_only=true", "exclude_mtp=true"], check=True)
    log = merged.parent / "log.json"
    info = {"task": "text-to-mermaid", "base": Path(args.base).name}
    if log.exists():
        info["training"] = json.loads(log.read_text(encoding="utf-8"))
    (out / MARKER).write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved to {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
