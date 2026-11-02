"""Cloud Run Jobs の入口。`python -m pf_agent.worker <job_id>` で、そのジョブを1回動かす。"""
from __future__ import annotations

import sys

from . import (  # noqa: F401  ジョブの処理を登録する
    agents,
    autodev,
    avatars,
    canvasjob,
    cycles,
    imports,
    jobs,
    meetings,
    pms,
    releases,
    reports,
    research,
    research_jobs,
    team,
)
from .db import init_db


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python -m pf_agent.worker <job_id>", file=sys.stderr)
        return 2
    init_db()
    # Cloud Run Jobs のログで、どのジョブを動かしたかを追えるように
    print(f"pf-worker: start job={sys.argv[1]}", flush=True)
    try:
        jobs.execute(sys.argv[1])
    finally:
        with jobs.session() as s:
            j = s.get(jobs.JobRun, sys.argv[1])
            print(f"pf-worker: end job={sys.argv[1]} kind={getattr(j, 'kind', '?')} status={getattr(j, 'status', '?')}",
                  flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
