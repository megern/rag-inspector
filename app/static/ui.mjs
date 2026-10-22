import {
  $,
  el,
  clear,
  metric,
  table,
  analyze,
  download,
  status,
  readFile,
  resultDetails,
  limitations,
  setupDownloads,
  percent,
  number
} from "./common.mjs";
let revision = 0;
let batch = [],
  batchReport = null;
let report = null,
  source = "manual input";
function docs() {
  return [...document.querySelectorAll(".doc-row")].map((r) => ({
    id: r.querySelector(".doc-id").value,
    text: r.querySelector(".doc-text").value
  }));
}
function input() {
  return {
    retrieved: docs(),
    relevant_ids: $("relevant")
      .value.split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    answer: $("answer").value,
    reference_answer: $("reference").value,
    k: Number($("k").value),
    ...($("grades").value.trim()
      ? { relevance_grades: JSON.parse($("grades").value) }
      : {})
  };
}
function invalidate() {
  revision++;
  report = null;
  batchReport = null;
  clear($("batch-results"));
  clear($("results"));
  $("results").append(
    el("p", "Query setup changed. Evaluate to refresh the results.")
  );
}
function drawDocs(list) {
  clear($("documents"));
  list.forEach((d, i) => {
    const row = el("div", undefined, "editor-row doc-row"),
      label = el("label", "Rank " + (i + 1) + " — document ID"),
      id = el("input");
    id.className = "doc-id";
    id.value = d.id;
    label.append(id);
    const textLabel = el("label", "Retrieved text"),
      text = el("textarea");
    text.className = "doc-text";
    text.value = d.text;
    textLabel.append(text);
    row.append(label, textLabel);
    const actions = el("div", undefined, "actions");
    for (const [caption, delta] of [
      ["Move up", -1],
      ["Move down", 1]
    ]) {
      const b = el("button", caption);
      b.disabled = i + delta < 0 || i + delta >= list.length;
      b.onclick = () => {
        const v = docs();
        [v[i], v[i + delta]] = [v[i + delta], v[i]];
        drawDocs(v);
        invalidate();
        source = "user-edited input; provenance unverified";
      };
      actions.append(b);
    }
    const remove = el("button", "Remove");
    remove.onclick = () => {
      const v = docs();
      v.splice(i, 1);
      drawDocs(v);
      invalidate();
      source = "user-edited input; provenance unverified";
    };
    actions.append(remove);
    row.append(actions);
    for (const x of [id, text])
      x.oninput = () => {
        source = "user-edited input; provenance unverified";
        invalidate();
      };
    $("documents").append(row);
  });
}
function load(v) {
  if (!v || !Array.isArray(v.retrieved))
    throw Error("Import needs retrieved documents as an array.");
  if (v.retrieved.length > 100) throw Error("At most 100 retrieved documents.");
  if (
    v.retrieved.some(
      (d) => !d || typeof d.id !== "string" || typeof d.text !== "string"
    )
  )
    throw Error("Each document requires text fields id and text.");
  if (
    !Array.isArray(v.relevant_ids) ||
    v.relevant_ids.some((x) => typeof x !== "string")
  )
    throw Error("relevant_ids must be a list of document IDs.");
  if (
    typeof v.answer !== "string" ||
    (v.reference_answer !== undefined && typeof v.reference_answer !== "string")
  )
    throw Error("answer and reference_answer must be text.");
  drawDocs(v.retrieved);
  $("relevant").value = v.relevant_ids.join(", ");
  $("answer").value = v.answer;
  $("reference").value = v.reference_answer || "";
  $("k").value = v.k ?? 5;
  $("grades").value =
    v.relevance_grades === undefined
      ? ""
      : JSON.stringify(v.relevance_grades, null, 2);
  invalidate();
}
function render(r, request) {
  const root = $("results");
  clear(root);
  root.classList.remove("empty");
  const m = el("div", undefined, "metrics");
  metric(
    m,
    "Precision @ k",
    percent(r.retrieval.precision_at_k),
    "Relevant hits divided by requested k"
  );
  metric(
    m,
    "Recall @ k",
    percent(r.retrieval.recall_at_k),
    "Hits divided by all relevant gold IDs"
  );
  metric(
    m,
    "Reciprocal rank",
    number(r.retrieval.reciprocal_rank_at_k),
    "1 / rank of first relevant hit"
  );
  metric(
    m,
    "Answer token F1",
    percent(r.answer.reference_token_f1),
    "Overlap with the reference answer"
  );
  metric(
    m,
    "Lexical groundedness",
    percent(r.answer.lexical_groundedness),
    "Answer tokens present in top-k text"
  );
  metric(
    m,
    "NDCG @ k",
    percent(r.retrieval.ndcg_at_k),
    "Normalized graded discounted gain"
  );
  metric(
    m,
    "Average precision @ k",
    percent(r.retrieval.average_precision_at_k),
    "Positive grades; min(k, positive gold count) denominator"
  );
  root.append(m);
  root.append(el("h3", "Top-k evidence inspection"));
  table(
    root,
    ["Rank", "Document ID", "Gold relevance", "Text"],
    request.retrieved
      .slice(0, request.k)
      .map((d, i) => [
        i + 1,
        d.id,
        request.relevant_ids.includes(d.id)
          ? "Relevant"
          : "Not labeled relevant",
        d.text
      ])
  );
  root.append(el("h3", "Answer tokens absent from evidence"));
  if (r.answer.unsupported_tokens.length)
    for (const word of r.answer.unsupported_tokens)
      root.append(el("span", word, "pill"));
  else
    root.append(
      el(
        "p",
        "No unsupported lexical tokens. This does not establish factual correctness."
      )
    );
  if (!request.reference_answer.trim())
    root.append(
      el(
        "p",
        "Reference answer is blank. Token F1 is zero by convention and is not a useful quality comparison for this query.",
        "notice"
      )
    );
  limitations(root, r.limitations);
  resultDetails(root, r);
}
$("add-doc").onclick = () => {
  const v = docs();
  if (v.length >= 100) {
    status("Document limit is 100.", true);
    return;
  }
  v.push({ id: "doc-" + (v.length + 1), text: "" });
  drawDocs(v);
  invalidate();
  source = "user-edited input; provenance unverified";
};
for (const id of ["relevant", "answer", "reference", "k", "grades"])
  $(id).oninput = () => {
    invalidate();
    source = "user-edited input; provenance unverified";
  };
$("sample").onclick = () => {
  load({
    retrieved: [
      {
        id: "doc-1",
        text: "Synthetic study: the treatment group contains 12 patients."
      },
      {
        id: "doc-2",
        text: "Synthetic study: the control group contains 8 patients."
      }
    ],
    relevant_ids: ["doc-1", "doc-3"],
    answer: "The treatment group contains 12 patients.",
    reference_answer: "The treatment group contains 12 patients.",
    k: 2
  });
  source = "synthetic example";
  status("Synthetic query loaded: doc-3 is relevant but was not retrieved.");
};
$("import").onchange = async (e) => {
  invalidate();
  const importRevision = revision;
  try {
    const text = await readFile(e.target.files[0]);
    if (revision !== importRevision) return;
    load(JSON.parse(text));
    source = "imported user data; provenance unverified";
    status("Evaluation setup imported. Verify the gold labels and rank order.");
  } catch (err) {
    if (revision === importRevision) status(err.message, true);
  }
};
$("run").onclick = async () => {
  invalidate();
  const requestRevision = revision;
  $("run").disabled = true;
  try {
    const request = input();
    status("Evaluating retrieval and lexical overlap…");
    const result = await analyze(request);
    if (revision !== requestRevision)
      throw Error(
        "Inputs changed during the request. Discarded its result; run again for the current setup."
      );
    report = { input: request, source, result };
    render(result, request);
    status("Evaluation finished. Inspect semantic accuracy separately.");
  } catch (e) {
    status(e.message, true);
  } finally {
    $("run").disabled = false;
  }
};
setupDownloads(input, () => report, "rag-inspector");
drawDocs([{ id: "doc-1", text: "" }]);

function drawBatch() {
  clear($("batch-preview"));
  table(
    $("batch-preview"),
    ["Query ID", "Documents", "Gold IDs", "Requested k"],
    batch.map((query) => [
      query.id,
      query.evaluation.retrieved.length,
      query.evaluation.relevant_ids.length,
      query.evaluation.k
    ])
  );
}
$("add-batch-query").onclick = () => {
  try {
    const id = $("batch-query-id").value.trim();
    if (!id || id.length > 100) throw Error("Query ID needs 1–100 characters.");
    if (batch.length >= 20 || batch.some((query) => query.id === id))
      throw Error("Batch allows at most 20 queries with unique IDs.");
    batch.push({ id, evaluation: input() });
    invalidate();
    drawBatch();
    status(
      "Current query snapshot added. Later editor changes do not modify the saved query."
    );
  } catch (error) {
    status(error.message, true);
  }
};
$("clear-batch").onclick = () => {
  batch = [];
  invalidate();
  drawBatch();
  status("Batch cleared.");
};
$("batch-import").onchange = async (event) => {
  invalidate();
  const importRevision = revision;
  try {
    const text = await readFile(event.target.files[0]);
    if (revision !== importRevision) return;
    const value = JSON.parse(text);
    const queries = Array.isArray(value) ? value : value.queries;
    if (!Array.isArray(queries) || queries.length < 1 || queries.length > 20)
      throw Error("Import needs 1–20 queries.");
    if (
      queries.some(
        (query) =>
          !query ||
          typeof query.id !== "string" ||
          !query.id.trim() ||
          !query.evaluation ||
          !Array.isArray(query.evaluation.retrieved) ||
          !Array.isArray(query.evaluation.relevant_ids)
      )
    )
      throw Error(
        "Each query needs id and evaluation with retrieved/relevant_ids arrays. See the guide."
      );
    if (new Set(queries.map((query) => query.id)).size !== queries.length)
      throw Error("Batch query IDs must be unique.");
    batch = queries;
    drawBatch();
    status(
      "Batch imported; provenance unverified. The API validates all query fields when evaluated."
    );
  } catch (error) {
    if (revision === importRevision) status(error.message, true);
  }
};
$("run-batch").onclick = async () => {
  invalidate();
  const requestRevision = revision;
  $("run-batch").disabled = true;
  try {
    if (!batch.length) throw Error("Add or import a query batch first.");
    const request = { queries: batch };
    const result = await analyze(request, "/batch");
    if (revision !== requestRevision) return;
    batchReport = {
      application: "rag-inspector",
      version: "0.4.0",
      generated_at: new Date().toISOString(),
      input: request,
      source: "user-assembled/imported batch; provenance unverified",
      result
    };
    const root = $("batch-results");
    root.append(el("h3", "Macro metrics (equal weight per defined query)"));
    table(
      root,
      ["Metric", "Mean", "Defined / total queries"],
      Object.entries(result.macro).map(([name, metric]) => [
        name,
        number(metric.value),
        `${metric.defined_cases}/${metric.total_cases}`
      ])
    );
    root.append(el("h3", "Per-query evaluation"));
    table(
      root,
      [
        "Query ID",
        "Precision @ k",
        "Recall @ k",
        "Reciprocal rank",
        "Token F1",
        "Lexical groundedness"
      ],
      result.cases.map((query) => [
        query.id,
        percent(query.result.retrieval.precision_at_k),
        percent(query.result.retrieval.recall_at_k),
        number(query.result.retrieval.reciprocal_rank_at_k),
        percent(query.result.answer.reference_token_f1),
        percent(query.result.answer.lexical_groundedness)
      ])
    );
    limitations(root, result.limitations);
    resultDetails(root, result);
    status(
      `Evaluated ${result.case_count} queries. Check defined-case counts before interpreting averages.`
    );
  } catch (error) {
    if (revision === requestRevision) status(error.message, true);
  } finally {
    $("run-batch").disabled = false;
  }
};
$("export-batch-input").onclick = () =>
  download(
    "rag-inspector-batch-input.json",
    JSON.stringify({ queries: batch }, null, 2)
  );
$("export-batch-report").onclick = () => {
  if (!batchReport) {
    status("Evaluate the current batch before exporting its report.", true);
    return;
  }
  download(
    "rag-inspector-batch-report.json",
    JSON.stringify(batchReport, null, 2)
  );
};

let pairedReport = null;
function invalidatePaired() {
  revision++;
  pairedReport = null;
  clear($("paired-results"));
}
function pairedInput() {
  return {
    baseline: JSON.parse($("paired-baseline").value),
    candidate: JSON.parse($("paired-candidate").value),
    bootstrap_iterations: Number($("paired-iterations").value),
    seed: Number($("paired-seed").value),
    confidence: Number($("paired-confidence").value)
  };
}
function loadPaired(value) {
  if (!value || !value.baseline || !value.candidate)
    throw Error("Import baseline and candidate batch objects.");
  $("paired-baseline").value = JSON.stringify(value.baseline, null, 2);
  $("paired-candidate").value = JSON.stringify(value.candidate, null, 2);
  $("paired-iterations").value = value.bootstrap_iterations ?? 500;
  $("paired-seed").value = value.seed ?? 42;
  $("paired-confidence").value = value.confidence ?? 0.95;
  invalidatePaired();
}
for (const id of [
  "paired-baseline",
  "paired-candidate",
  "paired-iterations",
  "paired-seed",
  "paired-confidence"
])
  $(id).oninput = invalidatePaired;
$("paired-use-baseline").onclick = () => {
  $("paired-baseline").value = JSON.stringify({ queries: batch }, null, 2);
  invalidatePaired();
  status("Current saved batch snapshotted as baseline.");
};
$("paired-use-candidate").onclick = () => {
  $("paired-candidate").value = JSON.stringify({ queries: batch }, null, 2);
  invalidatePaired();
  status("Current saved batch snapshotted as candidate.");
};
$("paired-sample").onclick = () => {
  const baseline = {
    queries: [
      {
        id: "synthetic-q1",
        evaluation: {
          retrieved: [
            { id: "other", text: "Synthetic: bicycles are green." },
            { id: "gold", text: "Synthetic: boats are blue." }
          ],
          relevant_ids: ["gold"],
          relevance_grades: { gold: 3 },
          answer: "Green.",
          reference_answer: "Blue.",
          k: 2
        }
      }
    ]
  };
  const candidate = JSON.parse(JSON.stringify(baseline));
  candidate.queries[0].evaluation.retrieved.reverse();
  candidate.queries[0].evaluation.answer = "Blue.";
  loadPaired({ baseline, candidate });
  status(
    "Synthetic single-pair comparison loaded. Its bootstrap interval is degenerate and is not population evidence."
  );
};
$("paired-import").onchange = async (event) => {
  invalidatePaired();
  const generation = revision;
  try {
    const text = await readFile(event.target.files[0]);
    if (revision !== generation) return;
    loadPaired(JSON.parse(text));
    status("Paired batches imported; provenance unverified.");
  } catch (error) {
    if (revision === generation) status(error.message, true);
  }
};
$("run-paired").onclick = async () => {
  invalidatePaired();
  const generation = revision;
  $("run-paired").disabled = true;
  try {
    const request = pairedInput();
    const result = await analyze(request, "/compare-batches");
    if (revision !== generation) return;
    pairedReport = {
      application: "rag-inspector",
      version: "0.4.0",
      generated_at: new Date().toISOString(),
      source:
        "paired user input; provenance unverified unless explicitly labeled synthetic",
      input: request,
      result
    };
    const root = $("paired-results");
    table(
      root,
      [
        "Metric",
        "Baseline mean",
        "Candidate mean",
        "Delta",
        "Defined pairs",
        "Bootstrap interval"
      ],
      Object.entries(result.metrics).map(([name, item]) => [
        name,
        number(item.baseline_mean),
        number(item.candidate_mean),
        number(item.mean_delta),
        `${item.defined_pairs}/${item.total_pairs}`,
        `${number(item.bootstrap_ci.lower)} to ${number(item.bootstrap_ci.upper)}`
      ])
    );
    for (const query of result.cases) {
      root.append(el("h3", query.id));
      table(
        root,
        ["Metric", "Baseline", "Candidate", "Delta"],
        Object.keys(query.deltas).map((name) => [
          name,
          number(query.baseline[name]),
          number(query.candidate[name]),
          number(query.deltas[name])
        ])
      );
    }
    limitations(root, result.limitations);
    resultDetails(root, result);
    status(
      "Paired comparison finished. Inspect sample size and undefined pairs before interpreting intervals."
    );
  } catch (error) {
    if (revision === generation) status(error.message, true);
  } finally {
    $("run-paired").disabled = false;
  }
};
$("export-paired-input").onclick = () => {
  try {
    download("rag-paired-input.json", JSON.stringify(pairedInput(), null, 2));
  } catch (error) {
    status(error.message, true);
  }
};
$("export-paired-report").onclick = () => {
  if (!pairedReport) {
    status("Run the current paired comparison before exporting.", true);
    return;
  }
  download("rag-paired-report.json", JSON.stringify(pairedReport, null, 2));
};
