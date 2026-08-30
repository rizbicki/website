import unittest

import pandas as pd

from infogripe_mixture import (
    attach_infogripe_mixture,
    estimate_infogripe_total_scale,
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

    def test_scales_point_interval_and_reported_count_to_total_srag(self):
        weeks = pd.date_range("2025-10-12", periods=14, freq="7D")
        history = [
            {
                "week": week.date().isoformat(),
                "observed": 20,
                "infogripe_filtered_observed": 10,
                "nowcast": None,
                "provisional": False,
            }
            for week in weeks[:-1]
        ]
        latest = {
            "week": weeks[-1].date().isoformat(),
            "observed": 5,
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
        self.assertEqual(result["infogripe_reported"], 20)
        self.assertEqual(result["infogripe"], 80)
        self.assertEqual(result["infogripe_lower80"], 60)
        self.assertEqual(result["infogripe_upper80"], 100)
        self.assertEqual(result["combined"], 90)
        self.assertEqual(payload["mixture"]["infogripe_total_scale"], 2)
        self.assertEqual(payload["mixture"]["scale_window_weeks"], 13)
        self.assertIn("combined", payload["backtest"])

    def test_scale_requires_enough_consolidated_weeks(self):
        rows = [
            {
                "week": week.date().isoformat(),
                "observed": 20,
                "infogripe_filtered_observed": 10,
                "provisional": False,
            }
            for week in pd.date_range("2026-01-04", periods=7, freq="7D")
        ]

        with self.assertRaisesRegex(RuntimeError, "fewer than 8"):
            estimate_infogripe_total_scale(rows)


if __name__ == "__main__":
    unittest.main()
