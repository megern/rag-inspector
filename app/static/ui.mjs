import {
  $,
  el,
  clear,
  metric,
  table,
  analyze,
  status,
  readFile,
  resultDetails,
  limitations,
  setupDownloads,
  percent,
  number
} from "./common.mjs";
let revision = 0;
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
    k: Number($("k").value)
  };
}
function invalidate() {
  revision++;
  report = null;
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
for (const id of ["relevant", "answer", "reference", "k"])
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
