# RAG Inspector user guide — 0.3.0

RAG Inspector helps diagnose a single retrieval-augmented answer using the actual ranked documents, labeled relevant IDs and an optional reference answer. A ranked-document editor connects retrieval metrics to the evidence being evaluated, instead of hiding the analysis in a JSON response.

## Workflow

1. Add the returned documents in retrieval order, with unique IDs and their text. Use **Move up / Move down** to correct ranking.
2. Enter the complete gold relevance IDs, including relevant documents the retriever missed.
3. Set requested k, paste the generated answer and optionally a reference answer.
4. Choose **Evaluate query**. Inspect top-k gold relevance, recall, reciprocal rank and unsupported lexical tokens.
5. Export the query setup or its report for review.

The synthetic example includes a relevant document that was not retrieved, so recall is intentionally incomplete. Edits/imports clear prior results. Imported labels are user-provided; the application does not determine which documents are relevant.

JSON import expects the same request shape as `examples/synthetic.json`: `retrieved` documents with `id`/`text`, `relevant_ids`, `answer`, optional `reference_answer`, and `k`.

## Metrics

- Precision@k = relevant hits in first k positions / requested k. Returning fewer than k documents still uses k as denominator.
- Recall@k = relevant hits / number of distinct relevant gold IDs. Empty gold relevance makes recall undefined (`null`).
- Reciprocal rank@k = 1 / first relevant rank in top k, or zero when there is no hit.
- Reference token F1 counts overlap using case-folded `\w+` tokens with repeated-token counts. A blank reference yields zero by convention.
- Lexical groundedness = answer-token occurrences present in the union of top-k document tokens / all answer tokens. Empty answer yields undefined (`null`). Unsupported tokens are unique answer tokens absent from that evidence.

**Lexical overlap is not entailment, semantic similarity, factual correctness or a hallucination detector.** Negation can have high overlap while reversing a fact. Relevant IDs should be labeled by a qualified reviewer for your use case. The tool does not run embedding retrieval or a generator; it evaluates evidence you supply.

## Limits and troubleshooting

At most 100 retrieved documents, 100 gold IDs and k 1–100. Document/answer text limit is 100000 characters; body limit 2 MiB. Retrieved document IDs must be unique.

- High groundedness but incorrect answer: inspect meaning and contradictions manually; this measure checks token presence only.
- F1 is zero: ensure a nonblank reference was supplied. Rephrased correct answers can still receive low token overlap.
- Recall is undefined: no gold relevant IDs were supplied.
- Precision looks lower than expected: check requested k and the number of returned documents.
- Duplicate-ID validation error: use one stable unique ID for each ranked document.

## Run locally

Docker (recommended):

```sh
docker compose up --build
```

Open http://localhost:8000. The interface, API reference at `/docs`, and user guide at `/guide` are served by the same app. The host port binds to localhost. Change only the host side of `8000:8000` if another app uses that port. The container runs as a non-root user with a read-only filesystem.

Python 3.12 or later:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-dev.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## Tests and release gates

```sh
python -m pytest -q
node --test tools/test_ui.mjs
python -m bandit -q -r app
python -m pip_audit -r requirements.txt
```

Node 22 is used for browser-independent CSV/export logic tests; it is not needed to serve the application. Python tests include actual core calculations, validation failures and in-process HTTP integration. They do not establish Docker deployment or browser interaction success. Fresh 0.3.0 evidence belongs in `evidence/improvements-0.3/`. `evidence/rebuild/` records the earlier 0.2.0 rebuild; it does not validate this version. CI includes locked dependency installation, test/security gates, image scanning and secret scanning. Branch protection and release publication remain separate operator actions; no publication success is claimed by this README.

MIT licensed. No paid service or new model download is required. Data is processed by this app server when you run an analysis. Inputs/results are not automatically saved by this application. JSON exports may contain the original input and sensitive values; inspect them before sharing. There is no authentication or rate limiter. Keep the localhost binding or supply access controls before exposing the server.

## Evaluate a labeled query batch (0.3.0)

Enter a unique query ID in **Labeled query batch**, then choose **Add current query to batch**. Each addition snapshots the current ranked documents, gold IDs, answer/reference and k. Editing the single-query editor later does not modify those snapshots. Repeat for additional queries, or import `examples/synthetic-batch.json`. Choose **Evaluate batch** to see per-query metrics and their macro averages. Export the batch setup to edit/reuse it, or export its evaluated report. Clearing/importing/adding queries invalidates prior batch reports.

`POST /batch` accepts `{ "queries": [{ "id": "query-1", "evaluation": { ...single-query-request... } }] }`. Single-query `/analyze` is unchanged. Macro means give each **defined** query equal weight. Every metric includes `value`, `defined_cases` and `total_cases`; null recall from empty gold labels and null groundedness from an empty answer are excluded rather than converted to zero. When no case defines a metric its macro value is null. Blank references still produce zero reference-token F1 by the existing convention, and are included in the F1 macro. Precision uses each case's requested k even if fewer documents were returned. Macros do not pool all hits/tokens into one denominator.

Limits: 1–20 unique query IDs of at most 100 characters; at most 500000 total document/answer/reference characters across the batch, plus the existing 2 MiB request cap and single-query limits. To bound output, each case shows up to 100 unsupported lexical tokens with at most 80 characters each; exact `unsupported_token_count` and a truncation flag are retained. Metric calculations always use full input tokens, not shortened detail. Synthetic examples are invented labeled cases, not a retrieval benchmark with external validity.
