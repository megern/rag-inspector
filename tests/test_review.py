"""Independent metrics checks with manually calculated synthetic answers."""
from app.core import EvaluationRequest, Document, analyze

def test_requested_k_denominator_and_unique_gold():
    result=analyze(EvaluationRequest(retrieved=[Document(id='a',text='alpha')],relevant_ids=['a','a'],answer='alpha',reference_answer='alpha',k=4))
    assert result['retrieval']['precision_at_k']==.25
    assert result['retrieval']['recall_at_k']==1
    assert result['retrieval']['returned_documents']==1

def test_repeated_tokens_lexical_grounding():
    result=analyze(EvaluationRequest(retrieved=[Document(id='a',text='cat')],relevant_ids=[],answer='cat cat dog',reference_answer='cat dog',k=1))
    assert abs(result['answer']['lexical_groundedness']-2/3)<1e-12
    assert abs(result['answer']['reference_token_f1']-.8)<1e-12
    assert result['answer']['unsupported_tokens']==['dog']

def test_only_top_k_is_used_for_grounding():
    result=analyze(EvaluationRequest(retrieved=[Document(id='a',text='cat'),Document(id='b',text='dog')],relevant_ids=['b'],answer='dog',k=1))
    assert result['answer']['lexical_groundedness']==0
    assert result['retrieval']['reciprocal_rank_at_k']==0
