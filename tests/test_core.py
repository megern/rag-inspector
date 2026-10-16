from app.core import *

def test_rank_metrics():
    r=analyze(EvaluationRequest(retrieved=[Document(id='a',text='a'),Document(id='b',text='b')],relevant_ids=['b','c'],answer='b',reference_answer='b',k=2))
    assert r['retrieval']['precision_at_k']==0.5
    assert r['retrieval']['recall_at_k']==0.5
    assert r['retrieval']['reciprocal_rank_at_k']==0.5
    assert r['answer']['reference_token_f1']==1
    assert r['answer']['lexical_groundedness']==1

def test_empty_and_unsupported():
    r=analyze(EvaluationRequest(retrieved=[],relevant_ids=[],answer='invented',k=5))
    assert r['retrieval']['recall_at_k'] is None
    assert r['answer']['lexical_groundedness']==0
    assert r['answer']['unsupported_tokens']==['invented']

def test_duplicate_rejected():
    import pytest
    with pytest.raises(ValueError): EvaluationRequest(retrieved=[Document(id='x',text=''),Document(id='x',text='')],relevant_ids=[],answer='')

def test_repetition_f1():
    r=analyze(EvaluationRequest(retrieved=[],relevant_ids=[],answer='cat cat',reference_answer='cat'))
    assert abs(r['answer']['reference_token_f1']-2/3)<1e-10
