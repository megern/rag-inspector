# RAG Inspector

Version 0.3.0 · CPU local tool · MIT

RAG Inspector helps diagnose a single retrieval-augmented answer using the actual ranked documents, labeled relevant IDs and an optional reference answer. A ranked-document editor connects retrieval metrics to the evidence being evaluated, instead of hiding the analysis in a JSON response.

## Try the interface

1. Add the returned documents in retrieval order, with unique IDs and their text. Use **Move up / Move down** to correct ranking.
2. Enter the complete gold relevance IDs, including relevant documents the retriever missed.
3. Set requested k, paste the generated answer and optionally a reference answer.
4. Choose **Evaluate query**. Inspect top-k gold relevance, recall, reciprocal rank and unsupported lexical tokens.
5. Export the query setup or its report for review.

The synthetic example includes a relevant document that was not retrieved, so recall is intentionally incomplete. Edits/imports clear prior results. Imported labels are user-provided; the application does not determine which documents are relevant.

JSON import expects the same request shape as `examples/synthetic.json`: `retrieved` documents with `id`/`text`, `relevant_ids`, `answer`, optional `reference_answer`, and `k`.

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

## Methods and operating details

Read [the complete user guide](docs/USER_GUIDE.md) for calculations, input schemas, limitations and troubleshooting. The same guide is served at `/guide`. The API and browser use the same tested computation path.

API example using explicitly synthetic data:

```sh
curl --fail-with-body http://localhost:8000/analyze -H 'Content-Type: application/json' --data-binary @examples/synthetic.json
```

## Evaluate a labeled query batch (0.3.0)

Enter a unique query ID in **Labeled query batch**, then choose **Add current query to batch**. Each addition snapshots the current ranked documents, gold IDs, answer/reference and k. Editing the single-query editor later does not modify those snapshots. Repeat for additional queries, or import `examples/synthetic-batch.json`. Choose **Evaluate batch** to see per-query metrics and their macro averages. Export the batch setup to edit/reuse it, or export its evaluated report. Clearing/importing/adding queries invalidates prior batch reports.

`POST /batch` accepts `{ "queries": [{ "id": "query-1", "evaluation": { ...single-query-request... } }] }`. Single-query `/analyze` is unchanged. Macro means give each **defined** query equal weight. Every metric includes `value`, `defined_cases` and `total_cases`; null recall from empty gold labels and null groundedness from an empty answer are excluded rather than converted to zero. When no case defines a metric its macro value is null. Blank references still produce zero reference-token F1 by the existing convention, and are included in the F1 macro. Precision uses each case's requested k even if fewer documents were returned. Macros do not pool all hits/tokens into one denominator.

Limits: 1–20 unique query IDs of at most 100 characters; at most 500000 total document/answer/reference characters across the batch, plus the existing 2 MiB request cap and single-query limits. To bound output, each case shows up to 100 unsupported lexical tokens with at most 80 characters each; exact `unsupported_token_count` and a truncation flag are retained. Metric calculations always use full input tokens, not shortened detail. Synthetic examples are invented labeled cases, not a retrieval benchmark with external validity.
