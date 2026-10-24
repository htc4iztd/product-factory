"""成果物の文章を作るLLM呼び出し。

APIキーがない環境（CI・ローカル）では決定的なスタブで動く。スタブは必須見出しを
すべて含む雛形を返すので、事前監査を通り、P0〜P5を一周できる。
"""
from __future__ import annotations

import os

from .stages import Stage


def provider() -> str:
    if os.environ.get("PF_LLM", "").lower() == "stub":
        return "stub"
    if os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY"):
        return "gemini"
    return "stub"


def model_name() -> str:
    return os.environ.get("PF_MODEL", "stub" if provider() == "stub" else "gemini-2.5-flash")


def _prompt(stage: Stage, idea: str, answers: str, upstream: dict[str, str],
            feedback: list[str]) -> str:
    ups = "\n\n".join(f"### 上流成果物 {k}\n{v}" for k, v in upstream.items()) or "（なし）"
    fb = "\n".join(f"- {f}" for f in feedback) or "（なし）"
    heads = "\n".join(f"## {h}" for h in stage.sections)
    return (
        f"あなたはプロダクト開発工場の「{stage.no} {stage.name}」担当です。\n"
        f"成果物「{stage.artifact}」をMarkdownで書いてください。次の見出しをすべて、この順で含めること:\n{heads}\n\n"
        f"# プロダクトの意図\n{idea}\n\n# ビルダーの回答\n{answers or '（なし）'}\n\n"
        f"# 上流の承認済み成果物\n{ups}\n\n# 直すべき指摘\n{fb}\n"
        "推測で数値を書かない。出典のない数値には「要確認」と書く。"
    )


def _stub(stage: Stage, idea: str, answers: str, upstream: dict[str, str],
          feedback: list[str]) -> str:
    lines = [f"# {stage.no} {stage.name}（{stage.artifact}）", ""]
    for h in stage.sections:
        lines += [f"## {h}", f"- {idea[:60]} に対する{h}（仮）"]
        if answers:
            lines.append(f"- ビルダーの回答：{answers[:120]}")
        lines.append("")
    if upstream:
        lines += ["## 参照した上流成果物", *[f"- {k}" for k in upstream], ""]
    if feedback:
        lines += ["## 反映した指摘", *[f"- {f}" for f in feedback], ""]
    return "\n".join(lines)


def generate_artifact(stage: Stage, idea: str, answers: str,
                      upstream: dict[str, str], feedback: list[str]) -> str:
    if provider() == "stub":
        return _stub(stage, idea, answers, upstream, feedback)
    from google import genai  # google-adk の依存に含まれる
    client = genai.Client(api_key=os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY"))
    resp = client.models.generate_content(
        model=model_name(), contents=_prompt(stage, idea, answers, upstream, feedback))
    return resp.text or ""
