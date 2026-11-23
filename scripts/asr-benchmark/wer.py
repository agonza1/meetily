"""Score a plain-text hypothesis against a plain-text reference."""

import argparse
from pathlib import Path
import re


def words(text):
    text = re.sub(r"\[(?:\d{1,2}:){1,2}\d{2}(?:\.\d+)?\]", " ", text)
    return re.findall(r"[^\W_]+(?:'[^\W_]+)*", text.casefold().replace("’", "'"))


def word_errors(reference, hypothesis):
    """Return minimum edit distance and its substitution, deletion, insertion counts."""
    previous = [(i, 0, 0, i) for i in range(len(hypothesis) + 1)]
    for row, expected in enumerate(reference, start=1):
        current = [(row, 0, row, 0)]
        for col, actual in enumerate(hypothesis, start=1):
            diagonal = previous[col - 1]
            if actual == expected:
                current.append(diagonal)
                continue
            cost, substitutions, deletions, insertions = diagonal
            replace = (cost + 1, substitutions + 1, deletions, insertions)
            cost, substitutions, deletions, insertions = previous[col]
            delete = (cost + 1, substitutions, deletions + 1, insertions)
            cost, substitutions, deletions, insertions = current[-1]
            insert = (cost + 1, substitutions, deletions, insertions + 1)
            current.append(min((replace, delete, insert), key=lambda item: item[0]))
        previous = current
    return previous[-1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path)
    parser.add_argument("hypotheses", type=Path, nargs="+")
    args = parser.parse_args()

    reference = words(args.reference.read_text(encoding="utf-8"))
    if not reference:
        parser.error("reference contains no words")
    for hypothesis in args.hypotheses:
        actual = words(hypothesis.read_text(encoding="utf-8"))
        total, substitutions, deletions, insertions = word_errors(reference, actual)
        print(f"{hypothesis.name}: {100 * total / len(reference):.2f}% WER "
              f"({substitutions} substitutions, {deletions} deletions, "
              f"{insertions} insertions, {len(reference)} reference words)")


if __name__ == "__main__":
    main()
