"""チームの非公開リポジトリから、自分が書いた・手を入れたファイルを取り出す。

何をするか
  1. チームのリポジトリの git の履歴から、ファイルを次の3つに分ける
       SOLE_FILES     自分だけが触ったファイル
       SHARED_FILES   自分と他のメンバーが触ったファイル
       SUPPORT_FILES  自分は触っていないが、ビルドと起動に必要なファイル
  2. 判定が想定した一覧と一致することを確かめてからコピーする
  3. 個人名・ローカルパス・鍵・メールアドレスが残っていないか検査する
  4. 1件でも見つかったら中止する（公開してしまわないため）

何をしないか
  - 上の一覧にないファイルはコピーしない（チームの README、チームが操作して溜まった投稿データ、
    他のメンバーだけが書いた機能、Android 以外のプラットフォームのひな形）
  - git の履歴は引き継がない（他のメンバーの氏名とメールアドレスが混ざるため）
  - 配布資料・企画資料・アップロード画像はコピーしない

テストデータの店名・地名・座標を架空のものに置き換える作業と、pubspec.yaml の文字化けの修正は、
コピーのあとに手で行っている（内容は source/README.md の「置き換えたもの」）。
そのため、source/ へ直接コピーし直すと置き換えが戻る。確かめるときは、第2引数で別の場所に出す。

個人情報を持たせないため、判定に使う氏名やメールアドレスはこのファイルに
書かず、バージョン管理の外に置いた設定から読む。

    scripts/identity.local.json （.gitignore 済み）
    {
      "author_email": "自分がコミットに使ったメールアドレス",
      "replacements": { "置き換えたい表示名": "中立な名前" },
      "forbidden_words": ["検査で弾きたい語", "..."]
    }

使い方
    python scripts/extract_from_team_repo.py <チームリポジトリのパス> [<出力先。既定は source/>]
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

# 自分が単独で書いたもの
SOLE_FILES = [
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

# 自分と他のメンバーが共同で編集したもの
SHARED_FILES = [
    "backend/src/routes/posts.ts",
    "backend/src/server.ts",
    "backend/src/services/likeService.ts",
    "backend/src/services/postService.ts",
    "backend/src/types/post.ts",
    "backend/tests/posts.test.ts",
    "frontend/.env.example",
    "frontend/android/app/build.gradle.kts",
    "frontend/android/app/src/main/AndroidManifest.xml",
    "frontend/lib/main.dart",
    "frontend/lib/models/post.dart",
    "frontend/lib/screens/create_post_screen.dart",
    "frontend/lib/screens/map_screen.dart",
    "frontend/lib/screens/post_detail_screen.dart",
    "frontend/lib/screens/timeline_screen.dart",
    "frontend/lib/services/api_client.dart",
    "frontend/lib/widgets/post_card.dart",
    "frontend/pubspec.yaml",
    "frontend/test/create_post_screen_test.dart",
    "frontend/test/post_model_test.dart",
    "frontend/test/timeline_screen_test.dart",
    "frontend/test/widget_test.dart",
    "frontend/web/index.html.template",
]

# 自分は触っていないが、ビルドと起動に必要なもの
SUPPORT_FILES = [
    "backend/src/services/distanceService.ts",
    "frontend/.metadata",
    "frontend/analysis_options.yaml",
    "frontend/lib/services/location_service.dart",
    "frontend/tools/generate_web_index.ps1",
    "frontend/web/favicon.png",
    "frontend/web/icons/Icon-192.png",
    "frontend/web/icons/Icon-512.png",
    "frontend/web/icons/Icon-maskable-192.png",
    "frontend/web/icons/Icon-maskable-512.png",
    "frontend/web/manifest.json",
    "frontend/android/.gitignore",
    "frontend/android/app/src/debug/AndroidManifest.xml",
    "frontend/android/app/src/main/kotlin/com/example/local_area_sns/MainActivity.kt",
    "frontend/android/app/src/main/res/drawable-v21/launch_background.xml",
    "frontend/android/app/src/main/res/drawable/launch_background.xml",
    "frontend/android/app/src/main/res/mipmap-hdpi/ic_launcher.png",
    "frontend/android/app/src/main/res/mipmap-mdpi/ic_launcher.png",
    "frontend/android/app/src/main/res/mipmap-xhdpi/ic_launcher.png",
    "frontend/android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png",
    "frontend/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png",
    "frontend/android/app/src/main/res/values-night/styles.xml",
    "frontend/android/app/src/main/res/values/styles.xml",
    "frontend/android/app/src/profile/AndroidManifest.xml",
    "frontend/android/build.gradle.kts",
    "frontend/android/gradle.properties",
    "frontend/android/gradle/wrapper/gradle-wrapper.properties",
    "frontend/android/settings.gradle.kts",
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


def authors_of(repository: Path, path: str) -> set[str]:
    return {
        line.strip()
        for line in run(repository, "log", "--format=%ae", "--", path).splitlines()
        if line.strip()
    }


def classify(repository: Path, email: str) -> tuple[set[str], set[str]]:
    """自分だけが触ったファイルと、自分と他のメンバーが触ったファイルを git の履歴から求める。"""
    sole, shared = set(), set()
    for path in run(repository, "ls-files").splitlines():
        authors = authors_of(repository, path)
        if authors == {email}:
            sole.add(path)
        elif email in authors:
            shared.add(path)
    return sole, shared


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


def check(label: str, actual: set[str], expected: set[str]) -> bool:
    if actual == expected:
        return True
    print(f"{label}: git の判定結果が想定と違います。")
    for path in sorted(expected - actual):
        print(f"  想定にあるが判定に出ない: {path}")
    for path in sorted(actual - expected):
        print(f"  判定に出たが想定にない: {path}")
    return False


def main() -> None:
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    repository = Path(sys.argv[1]).resolve()
    destination_root = Path(sys.argv[2]).resolve() if len(sys.argv) == 3 else DESTINATION
    if not (repository / ".git").is_dir():
        sys.exit(f"git リポジトリではありません: {repository}")

    identity = load_identity()
    email = identity["author_email"]
    sole, shared = classify(repository, email)
    # 共同編集のうち、チームの README とチームが操作して溜まった投稿データは収録しない
    shared -= {"README.md", "backend/data/posts.json"}
    touched_support = {path for path in SUPPORT_FILES if email in authors_of(repository, path)}
    ok = check("単独", sole, set(SOLE_FILES))
    ok = check("共同", shared, set(SHARED_FILES)) and ok
    ok = check("ビルドに必要なもの（自分が触っていないこと）", touched_support, set()) and ok
    if not ok:
        print("中止します。")
        sys.exit(1)

    files = SOLE_FILES + SHARED_FILES + SUPPORT_FILES
    replacements: dict[str, str] = identity.get("replacements", {})
    for relative in files:
        destination = destination_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(repository / relative, destination)
        try:
            text = destination.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for before, after in replacements.items():
            text = text.replace(before, after)
        destination.write_text(text, encoding="utf-8")

    problems = scan(destination_root, build_checks(identity.get("forbidden_words", [])))
    if problems:
        print("個人情報またはローカル情報が残っています。公開しないでください。")
        print("\n".join(problems))
        sys.exit(1)

    print(
        f"{len(files)} ファイル（単独 {len(SOLE_FILES)}・共同 {len(SHARED_FILES)}・"
        f"ビルドに必要なもの {len(SUPPORT_FILES)}）をコピーし、検査を通過しました。"
    )


if __name__ == "__main__":
    main()
