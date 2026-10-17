import re
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

    @model_validator(mode="after")
    def unique_ids(self):
        ids = [d.id for d in self.retrieved]
        if len(ids) != len(set(ids)):
            raise ValueError("retrieved document IDs must be unique")
        return self


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
            "Empty gold relevance makes recall undefined (null).",
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
        "retrieval": ["precision_at_k", "recall_at_k", "reciprocal_rank_at_k"],
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
