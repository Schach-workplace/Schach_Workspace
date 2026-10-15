"""Validate native guide artifacts without building, logging in or using a server."""

from pathlib import Path
import csv
import json
import re
import subprocess
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[2]
NEW = [
    "docs/deploy/NATIVE_TESTING_ROLLOUT.md",
    "docs/deploy/ANDROID_TESTING.md",
    "docs/deploy/IOS_TESTING.md",
]
DOCS = NEW + [
    "README.md", "docs/deploy/MOBILE_APPS.md", "docs/HANDOFF.md",
    "verification/native-guides-2026-10-15/record.md",
]


def anchors(path):
    # GitHub heading anchors used by these documents; exclude code fences.
    headings = []
    fenced = False
    for line in path.read_text().splitlines():
        if line.startswith("```"):
            fenced = not fenced
        if not fenced and re.match(r"^#{1,6} ", line):
            label = re.sub(r"^#+\s+", "", line).strip().lower()
            label = re.sub(r"[^\w\- ]", "", label).replace(" ", "-")
            headings.append(label)
    return headings


def main():
    links = 0
    shell_blocks = 0
    for name in DOCS:
        path = ROOT / name
        content = path.read_text()
        assert sum(line.startswith("```") for line in content.splitlines()) % 2 == 0, name
        for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", content):
            target = target.strip("<>")
            url = urlsplit(target)
            if url.scheme or url.netloc:
                continue
            dest = (path.parent / unquote(url.path)).resolve() if url.path else path
            assert dest.exists(), (name, target)
            if url.fragment and dest.suffix == ".md":
                assert unquote(url.fragment) in anchors(dest), (name, target, "anchor")
            links += 1
        if name in NEW:
            for block in re.findall(r"```bash\n(.*?)\n```", content, re.S):
                result = subprocess.run(["bash", "-n"], input=block, text=True, capture_output=True)
                assert result.returncode == 0, (name, result.stderr)
                shell_blocks += 1

    profiles = json.loads((ROOT / "mobile/eas.json").read_text())
    assert profiles["cli"]["appVersionSource"] == "remote"
    for profile in ["preview", "production"]:
        value = profiles["build"][profile]
        assert value["environment"] == profile
        assert value["env"]["EXPO_PUBLIC_SERVER_URL"] == "https://work.schachengineers.com"
    assert profiles["build"]["preview"]["android"]["buildType"] == "apk"
    assert profiles["build"]["production"]["android"]["buildType"] == "app-bundle"
    assert profiles["build"]["production"]["autoIncrement"] is True
    assert profiles["build"]["development"]["developmentClient"] is True
    scripts = json.loads((ROOT / "mobile/package.json").read_text())["scripts"]
    assert all(key in scripts for key in ["typecheck", "lint", "test"])
    config = (ROOT / "mobile/app.config.ts").read_text()
    assert 'const appId = "com.schachengineers.workspace"' in config
    assert 'version: "1.0.0"' in config
    assert 'name: "Workspace"' in config
    assert 'process.env.GOOGLE_SERVICES_JSON' in config
    assert '"expo-notifications"' in config
    client = (ROOT / "mobile/src/Workspace.tsx").read_text()
    assert "Notifications.getDevicePushTokenAsync()" in client
    provider = (ROOT / "backend/platform/push_providers.go").read_text()
    assert 'os.Getenv("APNS_SANDBOX") == "true"' in provider
    assert 'os.Getenv("FCM_SERVICE_ACCOUNT_FILE")' in provider
    assert 'process.env.EXPO_PUBLIC_SERVER_URL' in (ROOT / "mobile/src/serverConfig.ts").read_text()
    with (ROOT / "docs/qa/execution-log.csv").open(encoding="utf-8-sig", newline="") as file:
        cases = list(csv.DictReader(file))
    assert len(cases) == 224
    assert all(case["Status"] == "NOT_RUN" for case in cases)
    changed = subprocess.check_output(
        ["git", "diff", "--name-only", "72c949c475c310dca6f856c322093442720acc05"],
        cwd=ROOT, text=True,
    ).splitlines()
    assert not any(name.startswith(("mobile/", "backend/", "frontend/", "shared/", "encore/")) for name in changed)
    print(json.dumps({
        "status": "PASS",
        "markdownFiles": len(DOCS),
        "relativeLinksAndAnchors": links,
        "newGuideShellBlocksSyntaxChecked": shell_blocks,
        "sourceProfileAndPushContract": "PASS",
        "manualScenariosStillNotRun": len(cases),
        "applicationSourceUnchangedFrom": "72c949c",
        "qualification": "Documentation artifacts only; no cloud/native build, device or provider acceptance.",
    }, indent=2))


if __name__ == "__main__":
    main()
