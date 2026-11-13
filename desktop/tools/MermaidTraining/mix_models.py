"""Makes a model whose layers come from two conversions of the same trained model.

    python mix_models.py --fine desktop/models/a-b16 --coarse desktop/models/a-b32 --out desktop/models/a-mix --coarse-nodes "/mlp/" "/lm_head/"

The int4 conversion keeps one scale per block of weights: block 16 is more exact and
larger than block 32. Only some weights need the exact one. This takes every node from
--fine, except the ones whose name contains one of --coarse-nodes, which come
from --coarse. "/lm_head/" also moves the word table, which shares the head's weights.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

import onnx


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fine", required=True)
    parser.add_argument("--coarse", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--coarse-nodes", nargs="+", required=True, help="parts of node names to take from --coarse")
    args = parser.parse_args()

    fine = onnx.load(str(Path(args.fine) / "model.onnx"))
    coarse = onnx.load(str(Path(args.coarse) / "model.onnx"))
    patterns = [p if p != "/lm_head/" else ("/lm_head/", "/embed_tokens/") for p in args.coarse_nodes]
    patterns = [q for p in patterns for q in ([p] if isinstance(p, str) else p)]
    coarse_nodes = {n.name: n for n in coarse.graph.node}
    coarse_weights = {t.name: t for t in coarse.graph.initializer}
    weights = {t.name: t for t in fine.graph.initializer}

    swapped = 0
    for i, node in enumerate(fine.graph.node):
        if not any(p in node.name for p in patterns):
            continue
        other = coarse_nodes[node.name]
        fine.graph.node[i].CopyFrom(other)
        for name in other.input:
            if name in coarse_weights:
                weights[name] = coarse_weights[name]
        swapped += 1
    used = {name for n in fine.graph.node for name in n.input}
    del fine.graph.initializer[:]
    fine.graph.initializer.extend(t for name, t in weights.items() if name in used)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for f in Path(args.fine).iterdir():
        if f.is_file() and not f.name.startswith("model.onnx"):
            shutil.copy2(f, out / f.name)
    data = out / "model.onnx.data"
    data.unlink(missing_ok=True)
    onnx.save(fine, str(out / "model.onnx"), save_as_external_data=True, all_tensors_to_one_file=True,
              location=data.name, size_threshold=1024)
    print(f"{swapped} nodes taken from {args.coarse}; {data.stat().st_size / 1e6:.0f}MB", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
