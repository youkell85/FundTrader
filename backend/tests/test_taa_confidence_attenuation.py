import unittest
from unittest.mock import patch

from app.allocation import taa_engine


class _MacroSnapshot:
    def get_value(self, _name: str):
        return 100.0

    def get_confidence(self, _name: str):
        return 0.3


class TAAConfidenceAttenuationTest(unittest.TestCase):
    def test_low_confidence_signal_is_attenuated_not_zeroed(self):
        with patch("app.allocation.taa_engine._get_macro_snapshot", return_value=_MacroSnapshot()):
            signals = taa_engine._generate_live_signals()

        nonzero = [signal for signal in signals if signal.raw_score and abs(signal.raw_score) > 0.01]

        self.assertTrue(nonzero)
        self.assertTrue(all(signal.confidence == "low" for signal in nonzero))
        self.assertTrue(any(abs(signal.score) > 0.01 for signal in nonzero))
        self.assertAlmostEqual(nonzero[0].confidence_value, 0.3)
        self.assertAlmostEqual(nonzero[0].attenuation, round(0.3 ** 1.5, 3))


if __name__ == "__main__":
    unittest.main()
