"""Measures a trained model before it is made into ONNX (train.py's <out>/merged).

    python eval_merged.py desktop/out/mermaid-0.8b/merged [--kind given]

The same cases and the same requests as TextToMermaidEval (no repairs), but in
PyTorch at full precision. Comparing the two tells whether a wrong answer comes from
the training or from the int4 conversion. Prints the counts and the cases that fail.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))  # also when run with python -I

from make_data import EVAL_CASES, Validator, extract_code, matches_kind  # noqa: E402
from train import conversation  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("model")
    parser.add_argument("--kind", choices=("auto", "given"), default="auto")
    parser.add_argument("--max-new-tokens", type=int, default=768)
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    args = parser.parse_args()

    cases = json.loads(EVAL_CASES.read_text(encoding="utf-8"))
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    dtype = torch.bfloat16 if args.device == "cuda" else torch.float32
    model = AutoModelForCausalLM.from_pretrained(args.model, dtype=dtype).to(args.device).eval()
    end = tokenizer.convert_tokens_to_ids("<|im_end|>")

    valid = right = 0
    failed = []
    validator = Validator()
    try:
        for case in cases:
            prompt = tokenizer.apply_chat_template(conversation(case["text"], case["type"] if args.kind == "given" else None),
                                                   tokenize=False, add_generation_prompt=True, enable_thinking=False)
            ids = tokenizer(prompt, return_tensors="pt", add_special_tokens=False).to(args.device)
            with torch.no_grad():
                out = model.generate(**ids, max_new_tokens=args.max_new_tokens, do_sample=False, eos_token_id=end,
                                     pad_token_id=end)
            answer = tokenizer.decode(out[0, ids["input_ids"].shape[1]:], skip_special_tokens=True)
            result = validator.check(extract_code(answer))
            ok = result["valid"] and matches_kind(case["type"], result["type"])
            valid += result["valid"]
            right += ok
            if not ok:
                failed.append(f"{case['id']}: {result['type'] if result['valid'] else 'invalid'}")
    finally:
        validator.close()
    print(f"{Path(args.model).parent.name} ({args.kind}): valid {valid}/{len(cases)}, valid & right type {right}/{len(cases)}")
    for line in failed:
        print("  " + line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
