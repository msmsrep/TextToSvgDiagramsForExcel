"""Makes a base model with some of the layers left out, to be trained again with train.py.

    python drop_layers.py --base desktop/out/mermaid-0.8b/full --out desktop/out/hf/mermaid-0.8b-20 --drop 8-11

--base is a checkpoint in the original layout (the downloaded model, prune_vocab.py's
output, or export.py's <out>/full, which has the trained weights). The layers come in
groups of four (three linear attention, one full attention), so --drop takes whole
groups: 8-11, or 4-11. The model answers badly until it is trained again.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

from safetensors import safe_open
from safetensors.torch import save_file

LAYER = re.compile(r"^(model\.language_model\.layers\.)(\d+)(\..*)$")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--drop", required=True, help="first-last layer to leave out, counted from 0 (e.g. 8-11)")
    args = parser.parse_args()

    base, out = Path(args.base), Path(args.out)
    first, last = (int(x) for x in args.drop.split("-"))
    config = json.loads((base / "config.json").read_text(encoding="utf-8"))
    text = config.get("text_config", config)
    interval = text["full_attention_interval"]
    if first % interval or (last + 1) % interval or not 0 <= first <= last < text["num_hidden_layers"]:
        raise SystemExit(f"--drop takes whole groups of {interval} layers, e.g. {interval * 2}-{interval * 3 - 1}.")
    count = last - first + 1

    out.mkdir(parents=True, exist_ok=True)
    for f in base.iterdir():
        if f.is_file() and not f.name.startswith("model.safetensors"):
            shutil.copy2(f, out / f.name)
    tensors = {}
    for shard in sorted(base.glob("*.safetensors")):
        with safe_open(shard, "pt") as f:
            for key in f.keys():
                m = LAYER.match(key)
                if not m:
                    tensors[key] = f.get_tensor(key)
                    continue
                index = int(m.group(2))
                if first <= index <= last:
                    continue
                tensors[f"{m.group(1)}{index - count if index > last else index}{m.group(3)}"] = f.get_tensor(key)
    save_file(tensors, out / "model.safetensors", metadata={"format": "pt"})
    (out / "model.safetensors.index.json").write_text(
        json.dumps({"metadata": {}, "weight_map": {k: "model.safetensors" for k in tensors}}), encoding="utf-8")

    text["num_hidden_layers"] -= count
    del text["layer_types"][first:last + 1]
    (out / "config.json").write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{text['num_hidden_layers']} layers left in {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
