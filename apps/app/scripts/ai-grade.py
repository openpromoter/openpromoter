"""Checks AI output saved by ai-smoke.ts (--out=file) against docs/CONTENT-GUIDELINES.md.

Run from apps/app: python3 scripts/ai-grade.py ai-out.json
Uses the owner's comma linter in ~/ddpush when it is there.
"""

import json
import os
import re
import sys

sys.path.insert(0, os.path.expanduser("~/ddpush"))
try:
    from commalint import lint
except ImportError:  # ponytail: comma checks skipped without the owner's linter
    lint = None

BANNED = """seamless robust comprehensive bespoke tailored curated powerful innovative cutting-edge holistic
intuitive effortless meticulous elegant sophisticated strategic vital crucial pivotal optimal extensive significant
renowned vibrant world-class best-in-class high-performance leverage leverages leveraging utilize utilizes facilitate
implement streamline empower harness bolster supercharge elevate delight unlock unlocks ecosystem landscape paradigm
synergy methodology functionality furthermore moreover additionally notably crucially ultimately essentially
clearly obviously""".split()
IDIOMS = ["out of the box", "on autopilot", "under the hood", "moves the needle", "pays for itself", "game changer",
          "game-changer", "let's dive in", "when it comes to", "possibilities are endless"]

data = json.load(open(sys.argv[1]))
problems = 0
total_cost = 0.0
for item in data:
    total_cost += item["cost"]
    issues = []
    for text in item["texts"]:
        low = text.lower()
        if "—" in text:
            issues.append("em dash")
        if "!" in text:
            issues.append("exclamation mark")
        for w in BANNED:
            if re.search(rf"\b{re.escape(w)}\b", low):
                issues.append(f"banned word '{w}'")
        for i in IDIOMS:
            if i in low:
                issues.append(f"idiom '{i}'")
        for line in text.splitlines():
            for s in re.split(r"(?<=[.!?])\s+", line.strip()):
                words = len(re.findall(r"[\w'$%.,/-]+", s))
                if words > 25:
                    issues.append(f"{words}-word sentence: {s[:70]}...")
                if lint and words > 3:
                    found = lint(s, "short" if words <= 14 else "p")
                    if found:
                        issues.append(f"comma {found}: {s[:70]}")
    problems += len(issues)
    status = "PASS" if not issues else f"{len(issues)} issue(s)"
    print(f"{item['feature']:<48} ${item['cost']:.4f}  {status}")
    for i in issues:
        print(f"    - {i}")
print(f"\nTotal cost ${total_cost:.4f}, {problems} rule issue(s)")
