import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.core import BatchRequest, evaluate_batch


def fixture():
    return {
        "queries": [
            {
                "id": "first",
                "evaluation": {
                    "retrieved": [{"id": "a", "text": "cat"}],
                    "relevant_ids": ["a", "b"],
                    "answer": "cat",
                    "reference_answer": "cat",
                    "k": 2,
                },
            },
            {
                "id": "undefined",
                "evaluation": {
                    "retrieved": [],
                    "relevant_ids": [],
                    "answer": "",
                    "reference_answer": "",
                    "k": 5,
                },
            },
        ]
    }


def test_batch_macro_uses_defined_cases_and_keeps_requested_k_denominator():
    result = evaluate_batch(BatchRequest(**fixture()))
    assert result["case_count"] == 2
    assert result["macro"]["precision_at_k"] == {
        "value": 0.25,
        "defined_cases": 2,
        "total_cases": 2,
    }
    assert result["macro"]["recall_at_k"] == {
        "value": 0.5,
        "defined_cases": 1,
        "total_cases": 2,
    }
    assert result["macro"]["lexical_groundedness"] == {
        "value": 1.0,
        "defined_cases": 1,
        "total_cases": 2,
    }
    assert result["macro"]["reference_token_f1"]["value"] == 0.5
    assert result["cases"][0]["result"]["retrieval"]["precision_at_k"] == 0.5


def test_all_undefined_metrics_remain_null_and_duplicate_ids_rejected():
    payload = {"queries": [fixture()["queries"][1]]}
    result = evaluate_batch(BatchRequest(**payload))
    assert result["macro"]["recall_at_k"]["value"] is None
    assert result["macro"]["recall_at_k"]["defined_cases"] == 0
    with pytest.raises(ValueError, match="unique"):
        BatchRequest(queries=fixture()["queries"] * 2)


def test_batch_bounds_and_token_detail_do_not_change_full_metrics():
    query = fixture()["queries"][1]
    query["evaluation"]["answer"] = (
        " ".join("word" + str(i) for i in range(150)) + " " + "z" * 100
    )
    result = evaluate_batch(BatchRequest(queries=[query]))["cases"][0]["result"][
        "answer"
    ]
    assert result["unsupported_token_count"] == 151
    assert len(result["unsupported_tokens"]) == 100
    assert all(len(token) <= 80 for token in result["unsupported_tokens"])
    assert result["unsupported_tokens_truncated"]
    assert result["lexical_groundedness"] == 0
    with pytest.raises(ValueError):
        BatchRequest(queries=[{**query, "id": str(i)} for i in range(21)])
    big = {
        "id": "big",
        "evaluation": {
            "retrieved": [{"id": str(i), "text": "x" * 100000} for i in range(6)],
            "relevant_ids": [],
            "answer": "",
        },
    }
    with pytest.raises(ValueError, match="500000"):
        BatchRequest(queries=[big])


def test_batch_http_and_existing_single_api_remain_consistent():
    client = TestClient(app)
    response = client.post("/batch", json=fixture())
    assert response.status_code == 200
    single = client.post("/analyze", json=fixture()["queries"][0]["evaluation"]).json()
    assert response.json()["cases"][0]["result"]["retrieval"] == single["retrieval"]
    assert client.post("/batch", json={"queries": []}).status_code == 422


def test_blank_and_whitespace_duplicate_query_ids_are_rejected():
    client = TestClient(app)
    query = fixture()["queries"][0]
    assert (
        client.post("/batch", json={"queries": [{**query, "id": "  "}]}).status_code
        == 422
    )
    assert (
        client.post(
            "/batch", json={"queries": [{**query, "id": "a"}, {**query, "id": " a "}]}
        ).status_code
        == 422
    )
