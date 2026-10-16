import re
from pydantic import BaseModel, Field, model_validator


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
