import tempfile
import unittest
from pathlib import Path

import pandas as pd

from infogripe import load_infogripe_nowcasts, normalise_infogripe


def raw_row(uf="SP", year=2020, week=1):
    return {
        "IC80I": 8.0,
        "IC80S": 14.0,
        "Casos semanais reportados até a última atualização": 7.0,
        "casos estimados": 11.0,
        "Semana epidemiológica": week,
        "Ano epidemiológico": year,
        "DS_UF_SIGLA": uf,
        "escala": "casos",
    }


class InfoGripeFreshnessTests(unittest.TestCase):
    def test_rejects_a_missing_geography(self):
        with self.assertRaisesRegex(RuntimeError, "invalid geography set"):
            normalise_infogripe(pd.DataFrame([raw_row()]), ["SP", "RJ"])

    def test_rejects_a_stale_source_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "infogripe.csv"
            pd.DataFrame([raw_row()]).to_csv(
                path, sep=";", decimal=",", index=False
            )
            with self.assertRaisesRegex(RuntimeError, "latest week is .* days old"):
                load_infogripe_nowcasts(
                    source_url="https://example.invalid/infogripe.csv",
                    source_file=path,
                    max_retries=1,
                    max_age_days=21,
                    expected_ufs=["SP"],
                    user_agent="test",
                    credit="InfoGripe — Fiocruz",
                )


if __name__ == "__main__":
    unittest.main()
