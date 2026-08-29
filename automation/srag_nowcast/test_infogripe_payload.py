import unittest

import pandas as pd

from infogripe_payload import attach_infogripe_payload


class InfoGripePayloadTests(unittest.TestCase):
    def test_attaches_an_independently_published_latest_week(self):
        weeks = pd.date_range("2026-07-19", periods=5, freq="7D")
        payload = {
            "uf": "SP",
            "series": [
                {"week": week.date().isoformat(), "observed": index}
                for index, week in enumerate(weeks)
            ],
            "latest": {"week": weeks[-1].date().isoformat()},
            "backtest": {},
        }
        published = pd.DataFrame(
            {
                "uf": ["SP"] * 4,
                "week_start": weeks[:4],
                "reported": [10, 11, 12, 4],
                "mean": [10, 12, 14, 20],
                "lower80": [None, 11, 13, 17],
                "upper80": [None, 13, 16, 24],
            }
        )

        attach_infogripe_payload(payload, published)

        self.assertEqual(payload["latest"]["week"], "2026-08-16")
        self.assertEqual(payload["latest"]["infogripe_week"], "2026-08-09")
        self.assertEqual(payload["latest"]["infogripe"], 20)
        self.assertEqual(payload["latest"]["infogripe_reported"], 4)
        self.assertIsNone(payload["series"][-1]["infogripe"])
        self.assertIn("infogripe", payload["backtest"])


if __name__ == "__main__":
    unittest.main()
