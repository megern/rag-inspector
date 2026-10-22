import copy
import math
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def query():
    return {
        "retrieved": [{"id": "b", "text": "cat"}, {"id": "a", "text": "dog"}],
        "relevant_ids": ["a", "b"],
        "relevance_grades": {"a": 3, "b": 1},
        "answer": "cat",
        "reference_answer": "dog",
        "k": 2,
    }


def test_graded_ndcg_and_explicit_average_precision_normalization():
    result = client.post("/analyze", json=query()).json()["retrieval"]
    expected = (1 + 7 / math.log2(3)) / (7 + 1 / math.log2(3))
    assert result["ndcg_at_k"] == pytest.approx(expected)
    assert result["average_precision_at_k"] == 1
    assert result["average_precision_denominator"] == 2
    request = query()
    request["retrieved"] = [{"id": "c", "text": ""}, {"id": "b", "text": ""}]
    result = client.post("/analyze", json=request).json()["retrieval"]
    assert result["average_precision_at_k"] == 0.25
    assert result["ndcg_at_k"] == pytest.approx(
        (1 / math.log2(3)) / (7 + 1 / math.log2(3))
    )


def test_grade_validation_and_empty_gold_nulls():
    for grade in [-1, 4, True, "2", 1.5]:
        request = query()
        request["relevance_grades"]["a"] = grade
        assert client.post("/analyze", json=request).status_code == 422
    request = query()
    request["relevance_grades"] = {"a": 3}
    assert client.post("/analyze", json=request).status_code == 422
    request = {"retrieved": [], "relevant_ids": [], "answer": ""}
    result = client.post("/analyze", json=request).json()["retrieval"]
    assert result["ndcg_at_k"] is None and result["average_precision_at_k"] is None


def paired():
    base = {
        "retrieved": [{"id": "other", "text": ""}, {"id": "a", "text": "dog"}],
        "relevant_ids": ["a"],
        "answer": "cat",
        "reference_answer": "dog",
        "k": 2,
    }
    candidate = copy.deepcopy(base)
    candidate["retrieved"].reverse()
    candidate["answer"] = "dog"
    return {
        "baseline": {"queries": [{"id": "q", "evaluation": base}]},
        "candidate": {"queries": [{"id": "q", "evaluation": candidate}]},
        "bootstrap_iterations": 100,
        "seed": 42,
    }


def test_paired_bootstrap_known_constant_delta_and_reproducibility():
    request = paired()
    response = client.post("/compare-batches", json=request)
    assert response.status_code == 200
    result = response.json()
    rr = result["metrics"]["reciprocal_rank_at_k"]
    assert (
        rr["mean_delta"] == 0.5
        and rr["bootstrap_ci"]["lower"] == 0.5
        and rr["bootstrap_ci"]["upper"] == 0.5
    )
    assert result["metrics"]["reference_token_f1"]["mean_delta"] == 1
    assert result == client.post("/compare-batches", json=request).json()


def test_paired_id_gold_reference_k_mismatches_rejected_and_zero_grades_normalized():
    for mutate in [
        lambda q: q.update(id="other"),
        lambda q: q["evaluation"].update(relevant_ids=["b"]),
        lambda q: q["evaluation"].update(reference_answer="other"),
        lambda q: q["evaluation"].update(k=1),
    ]:
        request = paired()
        mutate(request["candidate"]["queries"][0])
        assert client.post("/compare-batches", json=request).status_code == 422
    request = paired()
    request["candidate"]["queries"][0]["evaluation"]["relevance_grades"] = {
        "a": 1,
        "zero": 0,
    }
    assert client.post("/compare-batches", json=request).status_code == 200


def test_bootstrap_undefined_pairs_are_excluded_and_limits_are_enforced():
    empty = {
        "id": "empty",
        "evaluation": {
            "retrieved": [],
            "relevant_ids": [],
            "answer": "",
            "reference_answer": "",
            "k": 2,
        },
    }
    request = {
        "baseline": {"queries": [empty]},
        "candidate": {"queries": [empty]},
        "bootstrap_iterations": 100,
    }
    result = client.post("/compare-batches", json=request).json()
    metric = result["metrics"]["ndcg_at_k"]
    assert metric["defined_pairs"] == 0 and metric["mean_delta"] is None
    assert metric["bootstrap_ci"]["lower"] is None
    request["bootstrap_iterations"] = 2001
    assert client.post("/compare-batches", json=request).status_code == 422
