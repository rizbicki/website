import unittest

import pandas as pd

from infogripe_mixture import (
    attach_infogripe_mixture,
    mix_predictions,
)


class InfoGripeMixtureTests(unittest.TestCase):
    def test_mixture_expands_when_components_disagree(self):
        mixed = mix_predictions(
            (1320.3, 985.8, 1698.8),
            (631, 555, 723),
        )

        self.assertAlmostEqual(mixed["mean"], 975.65)
        self.assertAlmostEqual(mixed["lower80"], 579.967, places=3)
        self.assertAlmostEqual(mixed["upper80"], 1557.993, places=3)
        self.assertEqual(mixed["envelope_lower"], 555)
        self.assertEqual(mixed["envelope_upper"], 1698.8)

    def test_keeps_infogripe_on_the_filtered_srag_target(self):
        weeks = pd.date_range("2025-10-12", periods=14, freq="7D")
        history = [
            {
                "week": week.date().isoformat(),
                "observed": 10,
                "observed_total": 20,
                "infogripe_filtered_observed": 10,
                "nowcast": None,
                "provisional": False,
            }
            for week in weeks[:-1]
        ]
        latest = {
            "week": weeks[-1].date().isoformat(),
            "observed": 1,
            "observed_total": 5,
            "infogripe_filtered_observed": 1,
            "nowcast": 100,
            "lower80": 80,
            "upper80": 120,
            "provisional": True,
        }
        payload = {
            "uf": "SP",
            "series": [*history, latest],
            "latest": {"week": latest["week"]},
            "backtest": {},
        }
        published = pd.DataFrame(
            {
                "uf": ["SP"] * len(weeks),
                "week_start": weeks,
                "reported": [10] * len(weeks),
                "mean": [10] * (len(weeks) - 1) + [40],
                "lower80": [10] * (len(weeks) - 1) + [30],
                "upper80": [10] * (len(weeks) - 1) + [50],
            }
        )

        attach_infogripe_mixture(payload, published)

        result = payload["latest"]
        self.assertEqual(result["infogripe_reported_raw"], 10)
        self.assertEqual(result["infogripe_raw"], 40)
        self.assertEqual(result["infogripe_raw_lower80"], 30)
        self.assertEqual(result["infogripe_raw_upper80"], 50)
        self.assertEqual(result["infogripe_reported"], 10)
        self.assertEqual(result["infogripe"], 40)
        self.assertEqual(result["infogripe_lower80"], 30)
        self.assertEqual(result["infogripe_upper80"], 50)
        self.assertEqual(result["combined"], 70)
        self.assertEqual(payload["series"][0]["infogripe_raw"], 10)
        self.assertEqual(payload["series"][0]["infogripe"], 10)
        self.assertIsNone(payload["series"][0]["combined"])
        self.assertEqual(payload["mixture"]["infogripe_target_scale"], 1)
        self.assertIn("infogripe", payload["backtest"])
        self.assertIn("combined", payload["backtest"])

    def test_infogripe_can_extend_beyond_trends(self):
        local = {
            "week": "2026-01-12",
            "observed": 50,
            "observed_total": 60,
            "infogripe_filtered_observed": 50,
            "nowcast": 100,
            "lower80": 80,
            "upper80": 120,
        }
        payload = {
            "uf": "SP",
            "series": [local],
            "latest": {"week": local["week"]},
            "backtest": {},
        }
        published = pd.DataFrame(
            {
                "uf": ["SP", "SP"],
                "week_start": ["2026-01-12", "2026-01-19"],
                "reported": [40, 20],
                "mean": [80, 70],
                "lower80": [60, 45],
                "upper80": [110, 105],
            }
        )

        attach_infogripe_mixture(payload, published)

        self.assertEqual(payload["latest"]["week"], "2026-01-12")
        self.assertEqual(payload["latest"]["infogripe_week"], "2026-01-19")
        self.assertEqual(payload["latest"]["combined_week"], "2026-01-12")
        tail = payload["series"][-1]
        self.assertEqual(tail["week"], "2026-01-19")
        self.assertIsNone(tail["nowcast"])
        self.assertEqual(tail["infogripe_raw"], 70)
        self.assertIsNone(tail["combined"])

    def test_trends_can_extend_beyond_infogripe(self):
        local = {
            "week": "2026-01-12",
            "observed": 50,
            "observed_total": 60,
            "infogripe_filtered_observed": 50,
            "nowcast": 100,
            "lower80": 80,
            "upper80": 120,
        }
        later = {
            **local,
            "week": "2026-01-19",
            "nowcast": 120,
            "lower80": 90,
            "upper80": 150,
        }
        payload = {
            "uf": "SP",
            "series": [local, later],
            "latest": {"week": later["week"]},
            "backtest": {},
        }
        published = pd.DataFrame(
            {
                "uf": ["SP"],
                "week_start": ["2026-01-12"],
                "reported": [40],
                "mean": [80],
                "lower80": [60],
                "upper80": [110],
            }
        )

        attach_infogripe_mixture(payload, published)

        self.assertEqual(payload["latest"]["week"], "2026-01-19")
        self.assertEqual(payload["latest"]["infogripe_week"], "2026-01-12")
        self.assertEqual(payload["latest"]["combined_week"], "2026-01-12")
        self.assertEqual(payload["series"][-1]["nowcast"], 120)
        self.assertIsNone(payload["series"][-1]["infogripe_raw"])
        self.assertIsNone(payload["series"][-1]["combined"])

if __name__ == "__main__":
    unittest.main()
