"""Cloud Run Jobs の入口。`python -m pf_agent.worker <job_id>` で、そのジョブを1回動かす。"""
from __future__ import annotations

import sys

from . import agents, autodev, avatars, canvasjob, imports, jobs, reports, research, research_jobs, team  # noqa: F401  ジョブの処理を登録する
from .db import init_db


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python -m pf_agent.worker <job_id>", file=sys.stderr)
        return 2
    init_db()
    jobs.execute(sys.argv[1])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
