import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCSV,
  inferValue,
  csvText,
  el,
  readFile,
  errorMessage
} from "../app/static/common.mjs";

test("CSV supports BOM, escaped quotes, embedded newlines, CRLF and empty cells", () => {
  const rows = parseCSV(
    '\uFEFFname,note,value\r\nAda,"says ""hello""\nand goodbye",\r\nBo,plain,2\r\n'
  );
  assert.deepEqual(rows, [
    { name: "Ada", note: 'says "hello"\nand goodbye', value: "" },
    { name: "Bo", note: "plain", value: "2" }
  ]);
});

test("CSV rejects ambiguity and reports the physical data-row position", () => {
  assert.throws(() => parseCSV("x,x\n1,2"), /unique/);
  assert.throws(() => parseCSV("x,y\n1"), /row 2 has 1 fields/);
  assert.throws(() => parseCSV('x\n"unclosed'), /unclosed/);
  assert.throws(() => parseCSV('x\n"quoted"tail'), /Unexpected text/);
  assert.throws(() => parseCSV('x\nnot"quoted'), /quote must start/);
});

test("Numeric inference preserves identifiers and rejects overflow", () => {
  assert.equal(inferValue("0012"), "0012");
  assert.equal(inferValue("1e3"), 1000);
  assert.equal(inferValue("-4.5"), -4.5);
  assert.equal(inferValue(""), null);
  assert.equal(inferValue("false"), false);
  assert.equal(inferValue("=SUM(A1:A2)"), "=SUM(A1:A2)");
  assert.throws(() => inferValue("1e400"), /Rescale/);
});

test("CSV export neutralizes formula cells including whitespace prefixes; negatives stay numeric", () => {
  const result = csvText([
    [
      "=2+2",
      "+command",
      "-command",
      "@SUM(A1:A2)",
      "\t=cmd",
      "\r\n+cmd",
      -2.5,
      'ordinary "quote"'
    ]
  ]);
  assert.equal(
    result,
    '"\'=2+2","\'+command","\'-command","\'@SUM(A1:A2)","\'\t=cmd","\'\r\n+cmd","-2.5","ordinary ""quote"""'
  );
});

test("Untrusted values are assigned to textContent, never interpreted as HTML", () => {
  const hostile = '<img src=x onerror="globalThis.compromised=true">';
  globalThis.document = {
    createElement: (tag) => ({ tag, textContent: "", className: "" })
  };
  const value = el("td", hostile);
  assert.equal(value.textContent, hostile);
  assert.equal(value.innerHTML, undefined);
  delete globalThis.document;
});

test("File size check happens before reading and API validation paths are actionable", async () => {
  let read = false;
  await assert.rejects(
    () =>
      readFile({
        size: 2097153,
        text: () => {
          read = true;
          return Promise.resolve("x");
        }
      }),
    /2 MiB/
  );
  assert.equal(read, false);
  assert.equal(
    errorMessage({
      detail: [{ loc: ["body", "rows", 2, "x"], msg: "invalid number" }]
    }),
    "rows.2.x: invalid number"
  );
});

// These tests import the production UI module, invoke its file handler, and delay File.text().
// A DOM adapter supplies browser primitives only; the import/generation logic is not copied.
test("Delayed actual UI file import cannot replace a newer synthetic sample", async () => {
  const { readFile: readLocal } = await import("node:fs/promises");
  const { documentFromHTML, deferred } = await import("./ui-test-dom.mjs");
  globalThis.document = documentFromHTML(
    await readLocal(new URL("../app/index.html", import.meta.url), "utf8")
  );
  await import("../app/static/ui.mjs?test=late-success");
  const read = deferred();
  const pending = document.getElementById("import").onchange({
    target: {
      files: [{ name: "setup.json", size: 100, text: () => read.promise }]
    }
  });
  document.getElementById("sample").onclick();
  const values = document.snapshot();
  const message = document.getElementById("status").textContent;
  read.resolve(
    await readLocal(
      new URL("../examples/synthetic.json", import.meta.url),
      "utf8"
    )
  );
  await pending;
  assert.deepEqual(document.snapshot(), values);
  assert.equal(document.getElementById("status").textContent, message);
  delete globalThis.document;
});

test("Late actual UI file rejection cannot replace newer status", async () => {
  const { readFile: readLocal } = await import("node:fs/promises");
  const { documentFromHTML, deferred } = await import("./ui-test-dom.mjs");
  globalThis.document = documentFromHTML(
    await readLocal(new URL("../app/index.html", import.meta.url), "utf8")
  );
  await import("../app/static/ui.mjs?test=late-rejection");
  const read = deferred();
  const pending = document.getElementById("import").onchange({
    target: {
      files: [{ name: "setup.json", size: 100, text: () => read.promise }]
    }
  });
  document.getElementById("sample").onclick();
  const message = document.getElementById("status").textContent;
  read.reject(Error("Old file read failed"));
  await pending;
  assert.equal(document.getElementById("status").textContent, message);
  delete globalThis.document;
});

test("Actual UI accepts an unsuperseded JSON file import", async () => {
  const { readFile: readLocal } = await import("node:fs/promises");
  const { documentFromHTML } = await import("./ui-test-dom.mjs");
  globalThis.document = documentFromHTML(
    await readLocal(new URL("../app/index.html", import.meta.url), "utf8")
  );
  await import("../app/static/ui.mjs?test=current-import");
  const text = await readLocal(
    new URL("../examples/synthetic.json", import.meta.url),
    "utf8"
  );
  await document.getElementById("import").onchange({
    target: {
      files: [{ name: "setup.json", size: text.length, text: async () => text }]
    }
  });
  assert.match(document.getElementById("status").textContent, /imported/i);
  delete globalThis.document;
});

test("Delayed actual UI file import cannot replace a manual field edit", async () => {
  const { readFile: readLocal } = await import("node:fs/promises");
  const { documentFromHTML, deferred } = await import("./ui-test-dom.mjs");
  globalThis.document = documentFromHTML(
    await readLocal(new URL("../app/index.html", import.meta.url), "utf8")
  );
  await import("../app/static/ui.mjs?test=manual-edit");
  document.getElementById("sample").onclick();
  const read = deferred();
  const pending = document.getElementById("import").onchange({
    target: {
      files: [{ name: "setup.json", size: 100, text: () => read.promise }]
    }
  });
  const field = document.getElementById("answer");
  field.value = "User changed this input while the file was reading";
  field.dispatch("input");
  const values = document.snapshot();
  read.resolve(
    await readLocal(
      new URL("../examples/synthetic.json", import.meta.url),
      "utf8"
    )
  );
  await pending;
  assert.deepEqual(document.snapshot(), values);
  delete globalThis.document;
});

test("CSV preserves explicit all-empty records at the beginning and end", () => {
  assert.deepEqual(parseCSV("x,y\n,\n1,2"), [
    { x: "", y: "" },
    { x: "1", y: "2" }
  ]);
  assert.deepEqual(parseCSV("x,y\n1,2\n,"), [
    { x: "1", y: "2" },
    { x: "", y: "" }
  ]);
  const inferred = parseCSV("x,y\n,\n1,2").map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, inferValue(v)]))
  );
  assert.deepEqual(inferred, [
    { x: null, y: null },
    { x: 1, y: 2 }
  ]);
  assert.equal(inferred.length, 2);
  assert.equal(inferred.filter((row) => row.x === null).length, 1);
  assert.equal(inferred.filter((row) => row.y === null).length, 1);
});

test("CSV preserves quoted empty single/multiple fields and multiline values", () => {
  assert.deepEqual(parseCSV('a\n""\n1'), [{ a: "" }, { a: "1" }]);
  assert.deepEqual(parseCSV('x,y\n"",""\n1,2'), [
    { x: "", y: "" },
    { x: "1", y: "2" }
  ]);
  assert.deepEqual(parseCSV('x,y\n"\n",""\n1,2'), [
    { x: "\n", y: "" },
    { x: "1", y: "2" }
  ]);
  assert.deepEqual(parseCSV('a\n1\n""'), [{ a: "1" }, { a: "" }]);
});

test("CSV ignores only blank physical lines and counts empty records toward row bounds", () => {
  assert.deepEqual(parseCSV("\n\nx,y\n\n,\n\n1,2\n\n"), [
    { x: "", y: "" },
    { x: "1", y: "2" }
  ]);
  assert.equal(parseCSV("x,y\n" + ",\n".repeat(5000)).length, 5000);
  assert.throws(() => parseCSV("x,y\n" + ",\n".repeat(5001)), /5000/);
});

test("Batch builder snapshots queries and renders macro defined-case denominators", async () => {
  const { readFile: readLocal } = await import("node:fs/promises");
  const { documentFromHTML } = await import("./ui-test-dom.mjs");
  globalThis.document = documentFromHTML(
    await readLocal(new URL("../app/index.html", import.meta.url), "utf8")
  );
  await import("../app/static/ui.mjs?feature=batch");
  document.getElementById("sample").onclick();
  document.getElementById("add-batch-query").onclick();
  const originalAnswer = document.getElementById("answer").value;
  document.getElementById("answer").value = "";
  document.getElementById("answer").dispatch("input");
  document.getElementById("batch-query-id").value = "query-2";
  document.getElementById("add-batch-query").onclick();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (endpoint, options) => {
    assert.equal(endpoint, "/batch");
    const request = JSON.parse(options.body);
    assert.equal(request.queries.length, 2);
    assert.equal(request.queries[0].evaluation.answer, originalAnswer);
    assert.equal(request.queries[1].evaluation.answer, "");
    // Synthetic protocol fixture: UI formatting only; API math is tested separately in pytest.
    return {
      ok: true,
      json: async () => ({
        case_count: 2,
        macro: {
          recall_at_k: { value: 0.5, defined_cases: 1, total_cases: 2 }
        },
        cases: [],
        limitations: []
      })
    };
  };
  try {
    await document.getElementById("run-batch").onclick();
    assert.match(document.getElementById("batch-results").textContent, /1\/2/);
    assert.match(
      document.getElementById("batch-results").textContent,
      /recall_at_k/
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.document;
  }
});

test("Delayed batch import cannot restore queries after clear", async () => {
  const { readFile: readLocal } = await import("node:fs/promises");
  const { documentFromHTML, deferred } = await import("./ui-test-dom.mjs");
  globalThis.document = documentFromHTML(
    await readLocal(new URL("../app/index.html", import.meta.url), "utf8")
  );
  await import("../app/static/ui.mjs?feature=batch-race");
  const read = deferred();
  const pending = document
    .getElementById("batch-import")
    .onchange({ target: { files: [{ size: 100, text: () => read.promise }] } });
  document.getElementById("clear-batch").onclick();
  const status = document.getElementById("status").textContent;
  read.resolve(
    await readLocal(
      new URL("../examples/synthetic-batch.json", import.meta.url),
      "utf8"
    )
  );
  await pending;
  assert.equal(document.getElementById("status").textContent, status);
  assert.doesNotMatch(
    document.getElementById("batch-preview").textContent,
    /synthetic-hit/
  );
  delete globalThis.document;
});

test("Paired comparison UI submits matching graded gold and displays paired CI denominators", async () => {
  const { readFile: local } = await import("node:fs/promises");
  const { documentFromHTML } = await import("./ui-test-dom.mjs");
  globalThis.document = documentFromHTML(
    await local(new URL("../app/index.html", import.meta.url), "utf8")
  );
  await import("../app/static/ui.mjs?feature=paired04");
  document.getElementById("paired-sample").onclick();
  const original = globalThis.fetch;
  globalThis.fetch = async (path, options) => {
    assert.equal(path, "/compare-batches");
    const request = JSON.parse(options.body);
    assert.deepEqual(
      request.baseline.queries[0].evaluation.relevance_grades,
      request.candidate.queries[0].evaluation.relevance_grades
    );
    assert.equal(request.bootstrap_iterations, 500);
    return {
      ok: true,
      json: async () => ({
        metrics: {
          ndcg_at_k: {
            baseline_mean: 0.6,
            candidate_mean: 1,
            mean_delta: 0.4,
            defined_pairs: 1,
            total_pairs: 1,
            bootstrap_ci: { lower: 0.4, upper: 0.4 }
          }
        },
        cases: [],
        limitations: ["Exploratory paired intervals."]
      })
    };
  };
  try {
    await document.getElementById("run-paired").onclick();
    const text = document.getElementById("paired-results").textContent;
    assert.match(text, /1\/1/);
    assert.match(text, /0.4 to 0.4/);
    assert.match(text, /Exploratory paired intervals/);
  } finally {
    globalThis.fetch = original;
    delete globalThis.document;
  }
});

test("Late paired-file import cannot replace a newer comparison example", async () => {
  const { readFile: local } = await import("node:fs/promises");
  const { documentFromHTML, deferred } = await import("./ui-test-dom.mjs");
  globalThis.document = documentFromHTML(
    await local(new URL("../app/index.html", import.meta.url), "utf8")
  );
  await import("../app/static/ui.mjs?feature=paired-import04");
  const read = deferred();
  const pending = document
    .getElementById("paired-import")
    .onchange({ target: { files: [{ size: 100, text: () => read.promise }] } });
  document.getElementById("paired-sample").onclick();
  const snapshot = document.getElementById("paired-baseline").value;
  read.resolve(
    await local(
      new URL("../examples/synthetic-paired.json", import.meta.url),
      "utf8"
    )
  );
  await pending;
  assert.equal(document.getElementById("paired-baseline").value, snapshot);
  delete globalThis.document;
});
