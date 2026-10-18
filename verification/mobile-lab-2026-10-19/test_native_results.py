"""Driver correctness checks: no emulator or application mutation."""
import unittest
from native_results import run_case, finalize


def fail(message):
    def operation(*_):
        raise RuntimeError(message)
    return operation


class NativeResultTests(unittest.TestCase):
    def test_failed_operation_survives_failed_capture_and_cleanup(self):
        cases = []
        run_case(cases, {"name": "chat"}, fail("send failed"), fail("capture failed"), fail("cleanup failed"))
        self.assertEqual(len(cases), 1)
        self.assertEqual(cases[0]["status"], "FAIL")
        self.assertEqual(cases[0]["error"], "send failed")
        self.assertEqual(len(cases[0]["diagnostics"]), 2)
        self.assertEqual(finalize({"cases": cases}, ["chat"])["status"], "FAIL")

    def test_capture_failure_cannot_turn_successful_operation_into_pass(self):
        cases = []
        run_case(cases, {"name": "screen"}, lambda: {"labels": ["actual destination"]}, fail("capture unavailable"))
        self.assertEqual(cases[0]["status"], "FAIL")

    def test_final_hierarchy_failure_stays_failed(self):
        cases = []
        run_case(cases, {"route": "work"}, fail("last hierarchy read failed"), lambda _: None)
        self.assertEqual(cases[0]["status"], "FAIL")

    def test_missing_duplicate_and_unexpected_cases_fail_coverage(self):
        for names in [[], ["a"], ["a", "a"], ["a", "b", "c"]]:
            result = finalize({"cases": [{"name": n, "status": "PASS"} for n in names]}, ["a", "b"])
            self.assertEqual(result["status"], "FAIL")

    def test_fatal_driver_error_cannot_pass_complete_matrix(self):
        self.assertEqual(finalize({"cases": [{"name": "a", "status": "PASS"}], "fatalError": "restore failed"}, ["a"])["status"], "FAIL")

    def test_complete_success_requires_every_operation_and_capture(self):
        cases = []
        run_case(cases, {"name": "a"}, lambda: {"labels": ["actual"]}, lambda _: None)
        self.assertEqual(finalize({"cases": cases}, ["a"])["status"], "PASS")


if __name__ == "__main__":
    unittest.main()
