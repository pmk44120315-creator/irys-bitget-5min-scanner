"""Regression for queue-frozen GitHub Actions checkout SHA and no-force source protection."""
from pathlib import Path
import unittest

WORKFLOW = Path(__file__).resolve().parent.parent / ".github/workflows/scan.yml"

class CheckoutQueueSafety(unittest.TestCase):
    def setUp(self):
        self.y = WORKFLOW.read_text(encoding="utf-8")

    def test_fetch_live_main_before_any_market_collection(self):
        start=self.y.index("- uses: actions/checkout@v4")
        next_step=self.y.index("- uses: actions/setup-python@v5",start)
        checkout=self.y[start:next_step]
        self.assertIn("ref: main",checkout)
        self.assertIn("git fetch --quiet origin main",checkout)
        self.assertIn("git reset --hard origin/main",checkout)
        self.assertLess(self.y.index("git reset --hard origin/main"),self.y.index("run: python collector.py"))

    def test_original_schedule_lock_and_safe_conflict_abort_preserved(self):
        self.assertIn("workflow_dispatch:",self.y)
        self.assertIn("group: irys-bitget-main-writers",self.y)
        self.assertIn("cancel-in-progress: false",self.y)
        self.assertIn("queue: max",self.y)
        self.assertIn("git rebase --abort",self.y)
        self.assertIn("Refusing to overwrite newer snapshots",self.y)
        self.assertNotIn("git push --force",self.y)
        self.assertIn("git add data/latest.json data/state.json",self.y)

if __name__=="__main__":
    unittest.main()
