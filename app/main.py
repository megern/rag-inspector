from .access import AccessControl
from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from .core import EvaluationRequest, BatchRequest, analyze, evaluate_batch

app = FastAPI(title="RAG Inspector", version="0.4.0")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/", response_class=HTMLResponse)
def index():
    return Path(__file__).with_name("index.html").read_text()


@app.post("/analyze")
def run(request: EvaluationRequest):
    return analyze(request)


from .guard import InputGuard

app.add_middleware(InputGuard)


app.mount(
    "/assets", StaticFiles(directory=Path(__file__).with_name("static")), name="assets"
)


@app.get("/guide", response_class=PlainTextResponse)
def user_guide():
    return Path(__file__).with_name("USER_GUIDE.md").read_text()


@app.post("/batch")
def run_batch(request: BatchRequest):
    return evaluate_batch(request)


from .core import PairedBatchRequest, compare_batches


@app.post("/compare-batches")
def run_paired_comparison(request: PairedBatchRequest):
    return compare_batches(request)


app.add_middleware(AccessControl)
