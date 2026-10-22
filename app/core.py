import math
import random
import re
from typing import Annotated
from pydantic import BaseModel, ConfigDict, Field, model_validator


def tokens(text):
    return re.findall(r"\w+", text.casefold())


class Document(BaseModel):
    id: str = Field(min_length=1, max_length=200)
    text: str = Field(max_length=100000)


class EvaluationRequest(BaseModel):
    retrieved: list[Document] = Field(max_length=100)
    relevant_ids: list[str] = Field(max_length=100)
    answer: str = Field(max_length=100000)
    reference_answer: str = Field(default="", max_length=100000)
    k: int = Field(default=5, ge=1, le=100)
    relevance_grades: (
        dict[str, Annotated[int, Field(strict=True, ge=0, le=3)]] | None
    ) = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def unique_ids(self):
        ids = [d.id for d in self.retrieved]
        if len(ids) != len(set(ids)):
            raise ValueError("retrieved document IDs must be unique")
        if self.relevance_grades is not None:
            if any(
                not key
                or len(key) > 200
                or isinstance(grade, bool)
                or grade < 0
                or grade > 3
                for key, grade in self.relevance_grades.items()
            ):
                raise ValueError(
                    "Graded relevance uses document IDs up to 200 characters and integer grades 0..3"
                )
            if {
                key for key, grade in self.relevance_grades.items() if grade > 0
            } != set(self.relevant_ids):
                raise ValueError(
                    "Positive-grade document IDs must equal the distinct relevant_ids"
                )
        return self


def gold_grades(request):
    return (
        {key: grade for key, grade in request.relevance_grades.items() if grade > 0}
        if request.relevance_grades is not None
        else {key: 1 for key in request.relevant_ids}
    )


def ranking_metrics(request, ranked, hits):
    grades = gold_grades(request)
    dcg = sum(
        (2 ** grades.get(doc.id, 0) - 1) / math.log2(index + 2)
        for index, doc in enumerate(ranked)
    )
    ideal = sum(
        (2**grade - 1) / math.log2(index + 2)
        for index, grade in enumerate(
            sorted(grades.values(), reverse=True)[: request.k]
        )
    )
    ap_denominator = min(request.k, len(grades))
    return {
        "ndcg_at_k": dcg / ideal if ideal else None,
        "average_precision_at_k": sum(
            number / rank for number, rank in enumerate(hits, start=1)
        )
        / ap_denominator
        if ap_denominator
        else None,
        "gold_mode": "graded_0_to_3"
        if request.relevance_grades is not None
        else "binary_relevance",
        "average_precision_denominator": ap_denominator,
    }


def analyze(req: EvaluationRequest):
    from collections import Counter

    ranked = req.retrieved[: req.k]
    relevant = set(req.relevant_ids)
    hits = [i + 1 for i, d in enumerate(ranked) if d.id in relevant]
    a = Counter(tokens(req.answer))
    ref = Counter(tokens(req.reference_answer))
    overlap = sum((a & ref).values())
    ap = overlap / sum(a.values()) if a else 0.0
    ar = overlap / sum(ref.values()) if ref else 0.0
    evidence = set(tokens(" ".join(d.text for d in ranked)))
    supported = sum(v for t, v in a.items() if t in evidence)
    return {
        "retrieval": {
            **ranking_metrics(req, ranked, hits),
            "precision_at_k": len(hits) / req.k,
            "recall_at_k": len(hits) / len(relevant) if relevant else None,
            "reciprocal_rank_at_k": 1 / hits[0] if hits else 0.0,
            "returned_documents": len(ranked),
            "relevant_count": len(relevant),
        },
        "answer": {
            "reference_token_f1": 2 * ap * ar / (ap + ar) if ap + ar else 0.0,
            "lexical_groundedness": supported / sum(a.values()) if a else None,
            "unsupported_tokens": sorted(set(a) - evidence),
        },
        "limitations": [
            "Lexical overlap is not semantic correctness or factual entailment.",
            "Precision uses requested k even when fewer documents are returned.",
            "Empty gold relevance makes recall, NDCG and average precision undefined (null).",
            "NDCG uses gain 2^grade-1 and log2(rank+1), with ideal ranking from all normalized gold IDs, truncated to k.",
            "AP@k treats positive grades as relevant and divides summed hit precisions by min(k, distinct positive gold count).",
        ],
    }


class LabeledQuery(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: str = Field(min_length=1, max_length=100)
    evaluation: EvaluationRequest


class BatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    queries: list[LabeledQuery] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def bounded_batch(self):
        ids = [query.id for query in self.queries]
        if len(ids) != len(set(ids)):
            raise ValueError("batch query IDs must be unique")
        characters = sum(
            len(query.evaluation.answer)
            + len(query.evaluation.reference_answer)
            + sum(len(doc.text) for doc in query.evaluation.retrieved)
            for query in self.queries
        )
        if characters > 500000:
            raise ValueError("batch text must not exceed 500000 characters")
        return self


def evaluate_batch(req: BatchRequest):
    cases = []
    for query in req.queries:
        result = analyze(query.evaluation)
        unsupported = result["answer"]["unsupported_tokens"]
        result["answer"]["unsupported_token_count"] = len(unsupported)
        result["answer"]["unsupported_tokens_truncated"] = len(
            unsupported
        ) > 100 or any(len(token) > 80 for token in unsupported[:100])
        result["answer"]["unsupported_tokens"] = [
            token[:80] for token in unsupported[:100]
        ]
        cases.append({"id": query.id, "result": result})
    macro = {}
    for group, names in {
        "retrieval": [
            "precision_at_k",
            "recall_at_k",
            "reciprocal_rank_at_k",
            "ndcg_at_k",
            "average_precision_at_k",
        ],
        "answer": ["reference_token_f1", "lexical_groundedness"],
    }.items():
        for name in names:
            values = [
                case["result"][group][name]
                for case in cases
                if case["result"][group][name] is not None
            ]
            macro[name] = {
                "value": sum(values) / len(values) if values else None,
                "defined_cases": len(values),
                "total_cases": len(cases),
            }
    return {
        "case_count": len(cases),
        "cases": cases,
        "macro": macro,
        "limitations": [
            "Macro metrics weight defined cases equally; null values are excluded, never treated as zero.",
            "Precision divides by each query's requested k, including when fewer documents were returned.",
            "Lexical overlap is not entailment or factual correctness. Blank references yield token F1 zero.",
            "Batch unsupported-token detail is capped at 100 tokens of 80 characters per case; total counts remain exact.",
        ],
    }


class PairedBatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    baseline: BatchRequest
    candidate: BatchRequest
    bootstrap_iterations: int = Field(default=500, ge=100, le=2000)
    confidence: float = Field(default=0.95, ge=0.8, le=0.99, allow_inf_nan=False)
    seed: int = Field(default=42, ge=0, le=4294967295)

    @model_validator(mode="after")
    def same_evaluation_target(self):
        baseline = {query.id: query.evaluation for query in self.baseline.queries}
        candidate = {query.id: query.evaluation for query in self.candidate.queries}
        if baseline.keys() != candidate.keys():
            raise ValueError("Paired batches must contain exactly the same query IDs")
        for key, previous in baseline.items():
            current = candidate[key]
            if (
                gold_grades(previous) != gold_grades(current)
                or previous.reference_answer != current.reference_answer
                or previous.k != current.k
            ):
                raise ValueError(
                    "Paired queries require the same normalized positive gold grades, exact reference_answer and requested k: "
                    + key
                )
        return self


def percentile(values, probability):
    position = (len(values) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    return values[lower] + (values[upper] - values[lower]) * (position - lower)


def compare_batches(request: PairedBatchRequest):
    current = {query.id: query.evaluation for query in request.candidate.queries}
    cases = []
    metrics = {
        "retrieval": [
            "precision_at_k",
            "recall_at_k",
            "reciprocal_rank_at_k",
            "ndcg_at_k",
            "average_precision_at_k",
        ],
        "answer": ["reference_token_f1", "lexical_groundedness"],
    }
    for query in request.baseline.queries:
        previous_result, current_result = (
            analyze(query.evaluation),
            analyze(current[query.id]),
        )
        before, after, deltas = {}, {}, {}
        for group, names in metrics.items():
            for name in names:
                a, b = previous_result[group][name], current_result[group][name]
                before[name], after[name] = a, b
                deltas[name] = b - a if a is not None and b is not None else None
        cases.append(
            {"id": query.id, "baseline": before, "candidate": after, "deltas": deltas}
        )
    rng = random.Random(request.seed)  # nosec B311: reproducible statistical resampling, never credentials
    summary = {}
    for name in cases[0]["deltas"]:
        defined = [case for case in cases if case["deltas"][name] is not None]
        changes = [case["deltas"][name] for case in defined]
        means = (
            sorted(
                sum(rng.choice(changes) for _ in changes) / len(changes)
                for _ in range(request.bootstrap_iterations)
            )
            if changes
            else []
        )
        alpha = (1 - request.confidence) / 2
        summary[name] = {
            "baseline_mean": sum(case["baseline"][name] for case in defined)
            / len(defined)
            if defined
            else None,
            "candidate_mean": sum(case["candidate"][name] for case in defined)
            / len(defined)
            if defined
            else None,
            "mean_delta": sum(changes) / len(changes) if changes else None,
            "defined_pairs": len(defined),
            "total_pairs": len(cases),
            "bootstrap_ci": {
                "lower": percentile(means, alpha) if means else None,
                "upper": percentile(means, 1 - alpha) if means else None,
                "confidence": request.confidence,
                "iterations": request.bootstrap_iterations,
                "method": "paired percentile bootstrap over defined query deltas; linear quantiles",
            },
        }
    return {
        "case_count": len(cases),
        "cases": cases,
        "metrics": summary,
        "seed": request.seed,
        "limitations": [
            "Batches are paired by query ID and must use the same normalized gold, exact reference and k. Candidate-minus-baseline deltas use only pairs where both metrics are defined.",
            "Bootstrap intervals resample the supplied query pairs, not documents or tokens. A seed makes computation reproducible, not statistically representative.",
            "Small query sets can produce degenerate or misleading intervals. These are exploratory percentile intervals, not significance tests or guarantees of deployment quality.",
            "Binary relevance is normalized to grade1. Grade0 entries do not change gold identity; all positive IDs must match relevant_ids.",
        ],
    }
