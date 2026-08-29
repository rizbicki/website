import unittest

import pandas as pd

from infogripe import epiweek_start, normalise_infogripe


class InfoGripeTests(unittest.TestCase):
    def test_epiweek_53_and_sunday_start(self):
        self.assertEqual(epiweek_start(2025, 53), pd.Timestamp("2025-12-28"))
        self.assertEqual(epiweek_start(2026, 1), pd.Timestamp("2026-01-04"))
        with self.assertRaisesRegex(ValueError, "Invalid epidemiological"):
            epiweek_start(2026, 53)

    def test_schema_mapping_and_incidence_filter(self):
        raw = pd.DataFrame(
            {
                "IC80I": [8.0, 0.08],
                "IC80S": [14.0, 0.14],
                "Casos semanais reportados até a última atualização": [7.0, 0.07],
                "casos estimados": [11.0, 0.11],
                "Semana epidemiológica": [53, 53],
                "Ano epidemiológico": [2025, 2025],
                "DS_UF_SIGLA": ["SP", "SP"],
                "escala": ["casos", "incidência"],
            }
        )

        result = normalise_infogripe(raw, ["SP"])

        self.assertEqual(len(result), 1)
        self.assertEqual(result.loc[0, "week_start"], pd.Timestamp("2025-12-28"))
        self.assertEqual(result.loc[0, "reported"], 7.0)
        self.assertEqual(result.loc[0, "mean"], 11.0)
        self.assertEqual(result.loc[0, "lower80"], 8.0)
        self.assertEqual(result.loc[0, "upper80"], 14.0)


if __name__ == "__main__":
    unittest.main()
