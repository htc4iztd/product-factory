

def test_request_is_not_a_claim():
    """「〜の承認依頼を出しました」は、その発言に付けた依頼（主張ではない）。「承認しました」は主張。"""
    from pf_agent import facts

    assert facts.claim_kind("「対象を絞る」を合意メモに残す承認依頼を出しました。") is None
    assert facts.claim_kind("⑥の項目を書き換える承認依頼を出しました。") is None
    assert facts.claim_kind("リリースを承認しました。") is not None
