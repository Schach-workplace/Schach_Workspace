"""Fail-closed result accounting, independent of ADB and the application."""
def run_case(cases, identity, operation, capture, cleanup=None):
    record = {**identity, "status": "FAIL"}
    try:
        details = operation()
        if details:
            record.update(details)
        capture(False)
        record["status"] = "PASS"
    except Exception as error:
        record["status"] = "FAIL"
        record["error"] = str(error)
        for label, action in [("capture", lambda: capture(True)), ("cleanup", cleanup)]:
            if action:
                try:
                    action()
                except Exception as diagnostic:
                    record.setdefault("diagnostics", []).append(f"{label}: {diagnostic}")
    finally:
        cases.append(record)
    return record


def finalize(result, expected, identity="name"):
    actual = [case[identity] for case in result["cases"]]
    coverage = sorted(actual) == sorted(expected)
    result["coverage"] = {"expected": expected, "actual": actual, "complete": coverage}
    result["summary"] = {
        "passed": sum(case["status"] == "PASS" for case in result["cases"]),
        "failed": sum(case["status"] != "PASS" for case in result["cases"]),
    }
    result["status"] = "PASS" if coverage and not result["summary"]["failed"] and not result.get("fatalError") else "FAIL"
    return result
