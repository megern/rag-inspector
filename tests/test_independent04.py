import math
import pytest
from pydantic import ValidationError
from app.core import EvaluationRequest, PairedBatchRequest, analyze, compare_batches


def evaluation(ids, gold=None, grades=None, answer="a"):
    return {
        "retrieved": [{"id": i, "text": "a"} for i in ids],
        "relevant_ids": gold if gold is not None else ["a", "b", "c"],
        "answer": answer,
        "k": 3,
        **({"relevance_grades": grades} if grades is not None else {}),
    }


def test_truncated_return_still_uses_all_gold_and_requested_k():
    result = analyze(
        EvaluationRequest(**evaluation(["b"], grades={"a": 3, "b": 2, "c": 1}))
    )
    rank = result["retrieval"]
    assert rank["precision_at_k"] == pytest.approx(1 / 3)
    assert rank["average_precision_at_k"] == pytest.approx(1 / 3)
    assert rank["ndcg_at_k"] == pytest.approx(3 / (7 + 3 / math.log2(3) + 1 / 2))


def paired(a, b):
    return PairedBatchRequest(
        baseline={
            "queries": [
                {"id": "defined", "evaluation": a},
                {"id": "empty", "evaluation": evaluation([], gold=[], answer="")},
            ]
        },
        candidate={
            "queries": [
                {"id": "empty", "evaluation": evaluation([], gold=[], answer="")},
                {"id": "defined", "evaluation": b},
            ]
        },
        bootstrap_iterations=100,
    )


def test_paired_id_alignment_constant_change_and_null_exclusion():
    result = compare_batches(paired(evaluation([]), evaluation(["a", "b", "c"])))
    metric = result["metrics"]["recall_at_k"]
    assert metric["defined_pairs"] == 1 and metric["total_pairs"] == 2
    assert metric["mean_delta"] == 1
    assert metric["bootstrap_ci"]["lower"] == metric["bootstrap_ci"]["upper"] == 1
    assert result["cases"][1]["deltas"]["recall_at_k"] is None


@pytest.mark.parametrize(
    "change",
    [
        {"k": 2},
        {"reference_answer": "changed"},
        {"relevant_ids": ["x"]},
        {"relevance_grades": {"a": 3, "b": 1, "c": 1}},
    ],
)
def test_paired_targets_cannot_change(change):
    candidate = evaluation(["a"])
    candidate.update(change)
    with pytest.raises(ValidationError):
        paired(evaluation([]), candidate)
