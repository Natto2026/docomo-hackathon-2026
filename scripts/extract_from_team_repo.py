"""チームの非公開リポジトリから、自分が単独で書いたファイルだけを取り出す。

何をするか
  1. チームのリポジトリで「自分だけが触ったファイル」を git の履歴から判定する
  2. 想定した一覧と一致することを確かめてから source/ 配下へコピーする
  3. 個人名・ローカルパス・鍵・メールアドレスが残っていないか検査する
  4. 1件でも見つかったら中止する（公開してしまわないため）

何をしないか
  - 他のメンバーが1行でも触ったファイルはコピーしない
  - git の履歴は引き継がない（他のメンバーの氏名とメールアドレスが混ざるため）
  - 配布資料・企画資料・アップロード画像はコピーしない

個人情報を持たせないため、判定に使う氏名やメールアドレスはこのファイルに
書かず、バージョン管理の外に置いた設定から読む。

    scripts/identity.local.json （.gitignore 済み）
    {
      "author_email": "自分がコミットに使ったメールアドレス",
      "replacements": { "置き換えたい表示名": "中立な名前" },
      "forbidden_words": ["検査で弾きたい語", "..."]
    }

使い方
    python scripts/extract_from_team_repo.py <チームリポジトリのパス>
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DESTINATION = ROOT / "source"
IDENTITY_FILE = HERE / "identity.local.json"

# コピーするファイル（自分が単独で書いたもの）
EXPECTED_FILES = [
    "backend/.env.example",
    "backend/vitest.config.ts",
    "backend/scripts/seed-demo-posts.js",
    "backend/data/follows.json",
    "backend/data/users.json",
    "backend/src/routes/places.ts",
    "backend/src/routes/users.ts",
    "backend/src/services/followService.ts",
    "backend/src/services/jsonStore.ts",
    "backend/src/services/placesService.ts",
    "backend/src/services/userService.ts",
    "backend/src/types/user.ts",
    "backend/src/utils/env.ts",
    "backend/src/utils/params.ts",
    "backend/src/utils/upload.ts",
    "backend/tests/places.test.ts",
    "backend/tests/users.test.ts",
    "frontend/lib/models/place.dart",
    "frontend/lib/models/user.dart",
    "frontend/lib/screens/follow_requests_screen.dart",
    "frontend/lib/screens/user_profile_screen.dart",
    "frontend/lib/screens/users_screen.dart",
    "frontend/lib/services/browser_places.dart",
    "frontend/lib/services/browser_places_stub.dart",
    "frontend/lib/services/browser_places_web.dart",
    "frontend/lib/services/map_links.dart",
    "frontend/lib/services/map_links_stub.dart",
    "frontend/lib/services/map_links_web.dart",
    "frontend/lib/services/session.dart",
    "frontend/lib/widgets/flame_icons.dart",
    "frontend/lib/widgets/follow_button.dart",
    "frontend/lib/widgets/location_icon.dart",
    "frontend/lib/widgets/map_selection_card.dart",
    "frontend/lib/widgets/my_profile_header.dart",
    "frontend/lib/widgets/user_avatar.dart",
    "frontend/lib/widgets/user_switcher_sheet.dart",
    "frontend/test/follow_requests_screen_test.dart",
    "frontend/test/map_grouping_test.dart",
    "frontend/test/map_links_test.dart",
    "frontend/test/map_selection_card_test.dart",
    "frontend/test/user_model_test.dart",
    "frontend/test/users_screen_test.dart",
]

# 固有名詞を含まない、常に弾きたいもの
GENERIC_FORBIDDEN = {
    "Windowsのローカルパス": re.compile(r"[A-Za-z]:\\Users\\", re.IGNORECASE),
    "mac/Linuxのローカルパス": re.compile(r"/(?:home|Users)/[A-Za-z0-9._-]+/"),
    "APIキーらしき文字列": re.compile(r"AIza[0-9A-Za-z_-]{10,}"),
    "メールアドレス": re.compile(r"[A-Za-z0-9._%+-]+@(?!example\.)[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
}


def load_identity() -> dict:
    if not IDENTITY_FILE.exists():
        sys.exit(
            f"{IDENTITY_FILE.name} がありません。次の内容で作成してください。\n"
            '{\n  "author_email": "...",\n  "replacements": {"旧": "新"},\n'
            '  "forbidden_words": ["..."]\n}'
        )
    identity = json.loads(IDENTITY_FILE.read_text(encoding="utf-8"))
    if not identity.get("author_email"):
        sys.exit("author_email が設定されていません")
    return identity


def run(repository: Path, *arguments: str) -> str:
    result = subprocess.run(
        ["git", *arguments], cwd=repository, capture_output=True, text=True, check=True
    )
    return result.stdout


def solely_authored(repository: Path, email: str) -> set[str]:
    """自分だけが触ったファイルを git の履歴から求める。"""
    found = set()
    for path in run(repository, "ls-files").splitlines():
        authors = {
            line.strip()
            for line in run(repository, "log", "--format=%ae", "--", path).splitlines()
            if line.strip()
        }
        if authors == {email}:
            found.add(path)
    return found


def build_checks(forbidden_words: list[str]) -> dict[str, re.Pattern[str]]:
    checks = dict(GENERIC_FORBIDDEN)
    if forbidden_words:
        joined = "|".join(re.escape(word) for word in forbidden_words)
        checks["設定で指定した語"] = re.compile(joined, re.IGNORECASE)
    return checks


def scan(directory: Path, checks: dict[str, re.Pattern[str]]) -> list[str]:
    problems = []
    for path in sorted(directory.rglob("*")):
        if not path.is_file() or "node_modules" in path.parts:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for label, pattern in checks.items():
            found = pattern.search(text)
            if found:
                problems.append(f"  {path.relative_to(directory)}: {label} → {found.group(0)[:40]}")
    return problems


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    repository = Path(sys.argv[1]).resolve()
    if not (repository / ".git").is_dir():
        sys.exit(f"git リポジトリではありません: {repository}")

    identity = load_identity()
    actual = solely_authored(repository, identity["author_email"])
    expected = set(EXPECTED_FILES)
    if actual != expected:
        print("git の判定結果が想定と違います。中止します。")
        for path in sorted(expected - actual):
            print(f"  想定にあるが判定に出ない: {path}")
        for path in sorted(actual - expected):
            print(f"  判定に出たが想定にない: {path}")
        sys.exit(1)

    replacements: dict[str, str] = identity.get("replacements", {})
    for relative in EXPECTED_FILES:
        destination = DESTINATION / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(repository / relative, destination)
        try:
            text = destination.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for before, after in replacements.items():
            text = text.replace(before, after)
        destination.write_text(text, encoding="utf-8")

    problems = scan(DESTINATION, build_checks(identity.get("forbidden_words", [])))
    if problems:
        print("個人情報またはローカル情報が残っています。公開しないでください。")
        print("\n".join(problems))
        sys.exit(1)

    print(f"{len(EXPECTED_FILES)} ファイルをコピーし、検査を通過しました。")


if __name__ == "__main__":
    main()
