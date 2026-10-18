# Independent review

One fresh-context read-only reviewer inspected the combined product diff, new test drivers, environment ownership and evidence qualification. No Critical finding or actionable product regression was found in Workload initialization or KeyboardFrame lifecycle handling. The existing iOS path, current-source authority, retry and business-decision handlers remain intact.

An Important evidence-accounting defect was found: native screen status could become PASS before the last hierarchy read, and a diagnostic exception could omit a failed case. A controlled reproduction observed RED: a failed operation plus failed screenshot left zero cases. `native_results.py` now defaults to FAIL, sets PASS only after all operation/capture work, appends in finally, records diagnostic errors, rejects incomplete/duplicate/unexpected coverage and blocks PASS on fatal driver errors. Six device-independent tests pass, independently rerun by the reviewer.

Scoped re-review caught the same incomplete-coverage risk in `--only`, where prior case identities were being used as the expectation. Both modes now validate against the fixed19-route matrix, and a filter matching no new cases sets a fatal error. The reviewer confirmed this exact correction resolved the remaining finding.

The company-switch case was hardened to require the loaded conversation filter and selected Meridian after the invalid link, a fresh delayed check, absence of the private composer and finally restoration. Chat acceptance follows the existing new-message CTA before exact-body visibility and canonical exactly-one API checks. These are test-driver corrections; application permission and history behavior were preserved.

Evidence: [RED reporting reproduction](checks/native-accounting-red.log), [six GREEN accounting tests](checks/native-accounting-tests.log), [final source manifest](source-hashes.json). Final device outcomes remain separately recorded in result.json; review is not physical-iOS or provider acceptance.
