# RAG Inspector user guide — 0.4.0

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

Node 22 is used for browser-independent CSV/export logic tests; it is not needed to serve the application. Python tests include actual core calculations, validation failures and in-process HTTP integration. They do not establish Docker deployment or browser interaction success. Fresh 0.4.0 evidence belongs in `evidence/improvements-0.4/`. `evidence/rebuild/` records the earlier 0.2.0 rebuild; it does not validate this version. CI includes locked dependency installation, test/security gates, image scanning and secret scanning. Branch protection and release publication remain separate operator actions; no publication success is claimed by this README.

MIT licensed. No paid service or new model download is required. Data is processed by this app server when you run an analysis. Inputs/results are not automatically saved by this application. JSON exports may contain the original input and sensitive values; inspect them before sharing. Optional shared-key API access and per-process compute admission are available; see docs/OPERATIONS.md in the repository. These are not user accounts, distributed quotas or HTTPS. Keep the default localhost binding unless you supply the additional hosting controls.

## Evaluate a labeled query batch (0.4.0)

Enter a unique query ID in **Labeled query batch**, then choose **Add current query to batch**. Each addition snapshots the current ranked documents, gold IDs, answer/reference and k. Editing the single-query editor later does not modify those snapshots. Repeat for additional queries, or import `examples/synthetic-batch.json`. Choose **Evaluate batch** to see per-query metrics and their macro averages. Export the batch setup to edit/reuse it, or export its evaluated report. Clearing/importing/adding queries invalidates prior batch reports.

`POST /batch` accepts `{ "queries": [{ "id": "query-1", "evaluation": { ...single-query-request... } }] }`. Single-query `/analyze` is unchanged. Macro means give each **defined** query equal weight. Every metric includes `value`, `defined_cases` and `total_cases`; null recall from empty gold labels and null groundedness from an empty answer are excluded rather than converted to zero. When no case defines a metric its macro value is null. Blank references still produce zero reference-token F1 by the existing convention, and are included in the F1 macro. Precision uses each case's requested k even if fewer documents were returned. Macros do not pool all hits/tokens into one denominator.

Limits: 1–20 unique query IDs of at most 100 characters; at most 500000 total document/answer/reference characters across the batch, plus the existing 2 MiB request cap and single-query limits. To bound output, each case shows up to 100 unsupported lexical tokens with at most 80 characters each; exact `unsupported_token_count` and a truncation flag are retained. Metric calculations always use full input tokens, not shortened detail. Synthetic examples are invented labeled cases, not a retrieval benchmark with external validity.

## Graded ranking and paired comparisons (0.4)

The query editor accepts optional `relevance_grades`, a document-ID map of **strict integer 0–3** grades. Blank uses binary grade 1 for each distinct `relevant_ids` entry. With grades supplied, their positive-grade IDs must exactly equal the distinct relevant IDs; grade 0 does not add a relevant document. Zero-grade entries are ignored when normalizing gold identity. NDCG@k uses **exponential gain `2^grade−1`**, discounted by `log2(rank+1)`, divided by the ideal ranking of all normalized gold documents truncated to k. This is explicitly the exponential-gain variant, not linear gain. Empty positive gold makes NDCG undefined.

`average_precision_at_k` sums precision at each relevant hit rank in the top-k results and divides by **min(k, number of distinct positive gold IDs)**. Any positive grade counts as relevant for AP. This is a normalized truncated AP@k convention; it is not untruncated average precision over the entire collection. Empty gold makes AP undefined. Requested k still controls precision@k even when fewer documents are returned. Both new metrics also appear in batch macro summaries with defined-case counts. [Stanford's ranked-retrieval evaluation chapter](https://nlp.stanford.edu/IR-book/html/htmledition/evaluation-of-ranked-retrieval-results-1.html) gives the evaluation context; this application's precise gain, cutoff and denominator conventions are stated here to avoid mixing variants.

Use **Paired batch comparison** to import `examples/synthetic-paired.json`, or snapshot saved query batches as baseline/candidate. `POST /compare-batches` accepts baseline/candidate batch objects, bootstrap_iterations 100–2000, confidence 0.80–0.99 and seed 0–4294967295. Both sides must contain the same unique query IDs, normalized positive gold grades, exact reference-answer strings and requested k. IDs stand for the same underlying queries; the application cannot verify query semantics for you. Candidate document ordering/content and generated answers may differ.

Per-query deltas are candidate-minus-baseline. Each summary uses only pairs where **both** metric values are defined, reporting its paired denominator; zero defined pairs yield null means/deltas/intervals. A deterministic pseudorandom bootstrap resamples those query deltas with replacement, averages each resample and takes linearly interpolated percentile endpoints. Confidence is exploratory: one pair yields a degenerate interval and small/nonrepresentative query sets cannot support deployment claims. No p-values, significance claim, semantic judging or automatic retrieval run is introduced. Existing 20-query/500000-character-per-batch/2 MiB HTTP caps apply; comparison output contains bounded numeric summaries rather than repeated document text.

Exported paired reports preserve setup, seed, pair-level values/deltas, intervals and their definitions. A newer import/edit invalidates old results and stale file reads cannot overwrite it. Synthetic examples are visibly labeled and do not establish model or retrieval quality.
