"""
run_all.py — launch all three marketplace uAgents in one process group.

    python run_all.py

Each agent gets its own port (8001/8002/8003) and REST endpoints. Ctrl-C stops all.
For production / Agentverse you'd run each agent as its own deployment instead.
"""

import subprocess
import sys
import time

AGENTS = [
    "stable_invest_agent.py",
    "savings_agent.py",
    "bill_pay_agent.py",
    "balanced_growth_agent.py",
    "growth_agent.py",
    "high_yield_agent.py",
]


def main() -> None:
    procs = []
    try:
        for f in AGENTS:
            print(f"starting {f} ...")
            procs.append(subprocess.Popen([sys.executable, f]))
            time.sleep(1.0)
        print("\nAll marketplace agents running. Ctrl-C to stop.\n")
        for p in procs:
            p.wait()
    except KeyboardInterrupt:
        print("\nstopping agents ...")
    finally:
        for p in procs:
            p.terminate()


if __name__ == "__main__":
    main()
