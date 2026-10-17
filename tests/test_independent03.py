import pytest
from fastapi.testclient import TestClient
from app.main import app


def evaluation(retrieved, relevant, answer="", reference="", k=2):
    return {
        "retrieved": retrieved,
        "relevant_ids": relevant,
        "answer": answer,
        "reference_answer": reference,
        "k": k,
    }


def test_independent_macro_uses_per_case_defined_denominators():
    cases = [
        {
            "id": "one",
            "evaluation": evaluation(
                [{"id": "a", "text": "cat"}],
                ["a", "missing"],
                "cat cat ghost",
                "cat",
                2,
            ),
        },
        {"id": "two", "evaluation": evaluation([], [], "", "", 1)},
        {
            "id": "three",
            "evaluation": evaluation(
                [{"id": "b", "text": "dog"}], ["b"], "dog", "dog", 4
            ),
        },
    ]
    response = TestClient(app).post("/batch", json={"queries": cases})
    assert response.status_code == 200
    result = response.json()
    macro = result["macro"]
    assert macro["precision_at_k"]["value"] == pytest.approx((0.5 + 0 + 0.25) / 3)
    assert macro["recall_at_k"] == {"value": 0.75, "defined_cases": 2, "total_cases": 3}
    assert macro["reference_token_f1"]["value"] == pytest.approx((0.5 + 0 + 1) / 3)
    assert macro["lexical_groundedness"]["value"] == pytest.approx((2 / 3 + 1) / 2)
    assert macro["lexical_groundedness"]["defined_cases"] == 2


def test_independent_null_macros_and_duplicate_trimmed_ids():
    case = {"id": "q", "evaluation": evaluation([], [])}
    response = TestClient(app).post("/batch", json={"queries": [case]})
    assert response.status_code == 200
    assert response.json()["macro"]["recall_at_k"]["value"] is None
    assert response.json()["macro"]["lexical_groundedness"]["defined_cases"] == 0
    assert (
        TestClient(app)
        .post("/batch", json={"queries": [case, {**case, "id": " q "}]})
        .status_code
        == 422
    )


def test_independent_token_truncation_does_not_change_metric_denominator():
    words = ["x" + str(i) for i in range(130)] + ["z" * 100]
    response = TestClient(app).post(
        "/batch",
        json={
            "queries": [
                {
                    "id": "q",
                    "evaluation": evaluation(
                        [], [], answer=" ".join(words + words), reference="x0", k=1
                    ),
                }
            ]
        },
    )
    assert response.status_code == 200
    answer = response.json()["cases"][0]["result"]["answer"]
    assert answer["unsupported_token_count"] == 131
    assert (
        len(answer["unsupported_tokens"]) == 100
        and max(map(len, answer["unsupported_tokens"])) <= 80
    )
    assert answer["unsupported_tokens_truncated"] is True
    assert answer["reference_token_f1"] == pytest.approx(2 / (262 + 1))
