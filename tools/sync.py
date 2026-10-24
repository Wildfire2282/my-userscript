#!/usr/bin/env python3
"""从 Greasy Fork 同步 Wildfire2282 发布的全部用户脚本到 monorepo。

每个脚本对应 scripts/<slug>/ 包，本脚本负责：
  1. 遍历用户页（含分页）发现全部脚本；
  2. 从脚本详情页解析真实安装地址并下载最新 .user.js；
  3. 写入该包的 legacy/ 目录（线上版本快照），必要时补齐 package.json 与
     元数据块（userscript.meta.ts / .js，已迁移的包不重复创建）；
  4. 重新生成 scripts.json 清单，并刷新 README.md 里的脚本表格。

用法：
    python tools/sync.py             # 下载/更新有变化的脚本
    python tools/sync.py --check     # 只检查，不写文件；有更新时退出码为 1
    python tools/sync.py --force     # 忽略内容比对，强制重写全部脚本

仅依赖 Python 3.10+ 标准库，无需安装第三方包。
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = ROOT / "scripts"
MANIFEST_PATH = ROOT / "scripts.json"
README_PATH = ROOT / "README.md"

BASE_URL = "https://greasyfork.org"
USER_ID = 852134
USER_NAME = "Wildfire2282"
USER_URL = f"{BASE_URL}/zh-CN/users/{USER_ID}-wildfire2282"

# 包目录名（英文别名）：Greasy Fork ID -> slug。
# 不在表中的新脚本会退化为 script-<ID>；同步后把目录重命名为更友好的 slug 即可。
SLUGS: dict[int, str] = {
    579560: "youtube-transcript-copy",
    580630: "super-drag",
    582371: "capture-links",
    582576: "selection-copy",
}

ENTRY_CANDIDATES = ("src/main.ts", "src/main.js", "src/index.ts", "src/index.js")

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 "
    "my-userscript-sync/1.0"
)

README_START = "<!-- scripts:start -->"
README_END = "<!-- scripts:end -->"

MAX_PAGES = 30


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


class FetchError(RuntimeError):
    """下载失败且重试无效；`status` 是最后一次 HTTP 状态码（网络错误时为 None）。"""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


def fetch(url: str, *, timeout: int = 30, retries: int = 3) -> bytes:
    """GET 一个 URL，返回原始字节；网络错误按退避重试。"""
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            if exc.code in (404, 410):
                raise FetchError(f"{url} 返回 {exc.code}", exc.code) from exc
            last_error = exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
        if attempt < retries:
            time.sleep(1.5 * attempt)
    status = last_error.code if isinstance(last_error, urllib.error.HTTPError) else None
    raise FetchError(f"无法下载 {url}：{last_error}", status) from last_error


# ---------------------------------------------------------------------------
# 解析
# ---------------------------------------------------------------------------


class ScriptLinkParser(HTMLParser):
    """从用户页里收集 <a class="script-link" href="/zh-CN/scripts/<ID>-<slug>"> 名称</a>。"""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: dict[int, tuple[str, str]] = {}
        self._pending: tuple[int, str] | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a" or self._pending is not None:
            return
        attributes = {key: value or "" for key, value in attrs}
        if "script-link" not in attributes.get("class", "").split():
            return
        match = re.search(r"/scripts/(\d+)(?:-([^/?#]+))?", attributes.get("href", ""))
        if match:
            self._pending = (int(match.group(1)), match.group(2) or "")
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._pending is not None:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != "a" or self._pending is None:
            return
        script_id, slug = self._pending
        name = " ".join("".join(self._text).split())
        self.links.setdefault(script_id, (name, slug))
        self._pending = None
        self._text = []


def discover_scripts() -> dict[int, tuple[str, str]]:
    """遍历用户页（含分页），返回 {ID: (名称, 页面 slug)}。"""
    found: dict[int, tuple[str, str]] = {}
    for page in range(1, MAX_PAGES + 1):
        url = USER_URL if page == 1 else f"{USER_URL}?page={page}"
        parser = ScriptLinkParser()
        try:
            parser.feed(fetch(url).decode("utf-8", "replace"))
        except FetchError as exc:
            # 脚本不足一页时 Greasy Fork 对 page=2 返回 403，才算“没有下一页”。
            # 其它错误（超时、5xx）不能当成末尾：那会把清单悄悄截断。
            if page == 1 or exc.status != 403:
                raise
            break
        new_ids = [sid for sid in parser.links if sid not in found]
        for sid in new_ids:
            found[sid] = parser.links[sid]
        if not new_ids:
            break
        time.sleep(0.3)
    return found


def resolve_install_url(script_id: int) -> str:
    """从脚本详情页里取出 update.greasyfork.org 的安装地址。"""
    page = fetch(f"{BASE_URL}/zh-CN/scripts/{script_id}").decode("utf-8", "replace")
    match = re.search(
        rf"https://update\.greasyfork\.org/scripts/{script_id}/[^\"'<>\s]+\.user\.js", page
    ) or re.search(
        # 兜底同样锚定本脚本 ID：详情页里可能挂着“作者的其他脚本”，
        # 不限定 ID 会把别人的安装地址下载进本包。
        rf"https://update\.greasyfork\.org/scripts/{script_id}/[^\"'<>\s]*", page
    )
    if not match:
        raise FetchError(f"无法从脚本页解析安装地址：scripts/{script_id}")
    return html.unescape(match.group(0))


def parse_metadata(text: str) -> dict[str, list[str]]:
    """解析 ==UserScript== 元数据块，保留重复键（如 @match）。"""
    metadata: dict[str, list[str]] = {}
    inside = False
    for line in text.splitlines():
        stripped = line.strip()
        if re.match(r"^//\s*==UserScript==$", stripped):
            inside = True
            continue
        if re.match(r"^//\s*==/UserScript==$", stripped):
            break
        if not inside:
            continue
        # 值可以为空：`// @noframes` 也是合法字段，缺了它清单里就永远看不到这个标记。
        match = re.match(r"^//\s*@([\w:.-]+)(?:\s+(.*))?$", stripped)
        if match:
            metadata.setdefault(match.group(1), []).append((match.group(2) or "").strip())
    return metadata


def extract_banner(text: str) -> str:
    """取出文件顶部的 ==UserScript== 元数据块，用于生成 userscript.meta.js。

    找不到结束标记时返回空串：把整份脚本体当 banner 写进 userscript.meta.js，
    下次构建会把它当作元数据块，出来的产物直接是坏的。
    """
    lines: list[str] = []
    for line in text.splitlines():
        lines.append(line)
        if re.match(r"^//\s*==/UserScript==$", line.strip()):
            return "\n".join(lines) + "\n"
    return ""


def looks_like_userscript(text: str, metadata: dict[str, list[str]]) -> bool:
    """下载到的是不是一份完整的用户脚本。

    Greasy Fork 会返回 200 的 HTML（维护页、验证页、代理错误页）：直接写进
    legacy/ 会覆盖掉好的快照，而那份快照只能从 git 历史里找回。
    """
    if "==UserScript==" not in text or "==/UserScript==" not in text:
        return False
    return bool(first(metadata, "version"))


def first(metadata: dict[str, list[str]], key: str) -> str | None:
    values = metadata.get(key)
    return values[0] if values else None


def slug_for(script_id: int, page_slug: str) -> str:
    """优先用配置里的别名，其次用页面 slug（若为纯 ASCII）。"""
    if script_id in SLUGS:
        return SLUGS[script_id]
    if re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", page_slug or ""):
        return page_slug
    print(
        f"  提示：脚本 {script_id} 没有配置英文别名，暂用 script-{script_id} 作为包名；"
        "可在 tools/sync.py 的 SLUGS 中补充。",
        file=sys.stderr,
    )
    return f"script-{script_id}"


# ---------------------------------------------------------------------------
# 包结构
# ---------------------------------------------------------------------------


def package_dir(slug: str) -> Path:
    return SCRIPTS_DIR / slug


def legacy_path(slug: str, script_id: int) -> Path:
    return package_dir(slug) / "legacy" / f"{script_id}-{slug}.user.js"


def ensure_package(slug: str, script_id: int, text: str, metadata: dict[str, list[str]]) -> None:
    """补齐包骨架（package.json / userscript.meta.js），已存在时不覆盖。"""
    directory = package_dir(slug)
    (directory / "legacy").mkdir(parents=True, exist_ok=True)

    package_file = directory / "package.json"
    if not package_file.exists():
        version = first(metadata, "version") or "0.0.0"
        description = first(metadata, "description") or ""
        package = {
            "name": f"@my-userscript/{slug}",
            "version": version,
            "private": True,
            "description": description,
            "type": "module",
            "scripts": {"build": f"node ../../tools/build.mjs {slug}"},
        }
        package_file.write_text(
            json.dumps(package, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        print(f"  已创建 scripts/{slug}/package.json")

    meta_file = directory / "userscript.meta.js"
    # 已迁移的包用 .ts 保存元数据（版本由构建注入），两种后缀都算已存在，
    # 否则每次 sync 都会多出一个过期、不参与构建的 .js 副本。
    exists = any(
        (directory / name).exists() for name in ("userscript.meta.ts", "userscript.meta.js")
    )
    if not exists:
        banner = extract_banner(text)
        if banner:
            meta_file.write_text(banner, encoding="utf-8", newline="\n")
            print(f"  已创建 scripts/{slug}/userscript.meta.js")
        else:
            print(
                f"  警告：scripts/{slug}/ 的下载内容没有完整元数据块，未创建 userscript.meta.js",
                file=sys.stderr,
            )


# ---------------------------------------------------------------------------
# 清单与 README
# ---------------------------------------------------------------------------


def manifest_payload(entries: list[dict]) -> str:
    """用于判断清单是否真的变化（忽略 generatedAt）。"""
    return json.dumps(entries, ensure_ascii=False, sort_keys=True, indent=2)


def write_manifest(entries: list[dict], previous: dict | None) -> bool:
    """写 scripts.json；内容未变时保留旧的 generatedAt，避免无意义 diff。"""
    if previous:
        # 除了脚本数组，source 与 scriptCount 也要对得上：手改过的清单同样要修回来。
        same_scripts = manifest_payload(previous.get("scripts", [])) == manifest_payload(entries)
        same_meta = (
            previous.get("source") == USER_URL
            and previous.get("scriptCount") == len(entries)
            and isinstance(previous.get("generatedAt"), str)
        )
        if same_scripts and same_meta:
            return False

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = {
        "source": USER_URL,
        "generatedAt": now,
        "scriptCount": len(entries),
        "scripts": entries,
    }
    MANIFEST_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return True


def escape_cell(value: str) -> str:
    return value.replace("|", "\\|").replace("\n", " ").strip()


def render_table(entries: list[dict]) -> str:
    """生成人类可读的脚本表：只保留「叫什么、干什么、怎么装」。"""
    lines = [
        "| 脚本 | 作用 | 安装 |",
        "| --- | --- | --- |",
    ]
    for entry in entries:
        name = escape_cell(entry.get("name") or entry["slug"])
        description = escape_cell(entry.get("description") or "")
        lines.append(f"| {name} | {description} | [点此安装]({entry['downloadUrl']}) |")
    return "\n".join(lines)


def update_readme(entries: list[dict]) -> bool:
    """替换 README 中标记块之间的脚本表格；没有标记时原样返回。"""
    if not README_PATH.exists():
        print("警告：找不到 README.md，脚本表格未更新。", file=sys.stderr)
        return False
    text = README_PATH.read_text(encoding="utf-8")
    start = text.find(README_START)
    end = text.find(README_END)
    if start == -1 or end == -1 or end < start:
        # 标记被删掉后表格会悄悄停止维护：必须说出来，否则没人知道它已经不再更新。
        print(
            f"警告：README.md 里缺少 {README_START} / {README_END} 标记，脚本表格未更新。",
            file=sys.stderr,
        )
        return False

    header_end = text.find("\n", start)
    if header_end == -1:
        print("警告：README.md 的标记行不完整，脚本表格未更新。", file=sys.stderr)
        return False
    new_text = text[: header_end + 1] + render_table(entries) + "\n" + text[end:]
    if new_text == text:
        return False
    README_PATH.write_text(new_text, encoding="utf-8", newline="\n")
    return True


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------


def sync(*, check_only: bool, force: bool) -> int:
    print(f"发现脚本来源：{USER_URL}")
    discovered = discover_scripts()
    if not discovered:
        print("错误：没有在用户页上找到任何脚本。", file=sys.stderr)
        return 2
    # 分页请求失败时 discover_scripts 会把“网络错误”当成“没有下一页”。
    # 清单一旦被截断，scripts.json 与 README 表格会跟着少脚本，所以这里按
    # 已知脚本表做一次完整性校验：少一个就整轮失败，不写入半份清单。
    missing = [f"{script_id}（{slug}）" for script_id, slug in SLUGS.items() if script_id not in discovered]
    if missing:
        print(
            "错误：用户页上缺少已知脚本："
            + "、".join(missing)
            + "。可能是分页请求失败，稍后重试；确认已下线时先从 SLUGS 里删除。",
            file=sys.stderr,
        )
        return 2
    print(f"共发现 {len(discovered)} 个脚本。\n")

    SCRIPTS_DIR.mkdir(parents=True, exist_ok=True)

    previous_manifest: dict | None = None
    if MANIFEST_PATH.exists():
        try:
            previous_manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            previous_manifest = None

    entries: list[dict] = []
    changes: list[str] = []

    for index, script_id in enumerate(sorted(discovered), start=1):
        listing_name, page_slug = discovered[script_id]
        slug = slug_for(script_id, page_slug)
        path = legacy_path(slug, script_id)

        install_url = resolve_install_url(script_id)
        raw = fetch(install_url)
        text = raw.decode("utf-8-sig", "replace").replace("\r\n", "\n").replace("\r", "\n")
        if not text.endswith("\n"):
            text += "\n"

        metadata = parse_metadata(text)
        version = first(metadata, "version")
        if not looks_like_userscript(text, metadata):
            # 半页 HTML 或截断的响应：不覆盖快照、不写清单，等下次重跑。
            print(
                f"错误：scripts/{slug}/ 下载到的内容不是完整的用户脚本（缺元数据块或 @version），已中止。",
                file=sys.stderr,
            )
            return 2
        old_text = path.read_text(encoding="utf-8") if path.exists() else None
        old_version = first(parse_metadata(old_text), "version") if old_text else None
        changed = force or old_text != text

        if changed:
            changes.append(
                f"{slug}/legacy/{path.name}: {old_version or '(新增)'} -> {version or '(未知版本)'}"
            )
            if not check_only:
                ensure_package(slug, script_id, text, metadata)
                path.write_bytes(text.encode("utf-8"))

        entries.append(
            {
                "id": script_id,
                "name": first(metadata, "name") or listing_name or slug,
                "slug": slug,
                "package": f"scripts/{slug}",
                "file": f"scripts/{slug}/legacy/{path.name}",
                "version": version,
                "description": first(metadata, "description"),
                "author": first(metadata, "author") or USER_NAME,
                "namespace": first(metadata, "namespace"),
                "license": first(metadata, "license"),
                "match": metadata.get("match", []),
                "downloadUrl": install_url,
                "scriptUrl": f"{BASE_URL}/zh-CN/scripts/{script_id}",
                "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest().upper(),
                "size": len(text.encode("utf-8")),
            }
        )
        print(f"[{index}/{len(discovered)}] scripts/{slug}/  v{version or '?'}")
        time.sleep(0.4)

    if check_only:
        if not changes:
            print("\n所有脚本均为最新版本。")
            return 0
        print("\n检测到更新：")
        for line in changes:
            print(f"  {line}")
        return 1

    manifest_changed = write_manifest(entries, previous_manifest)
    readme_changed = update_readme(entries)

    print()
    if changes:
        print(f"已写入 {len(changes)} 个脚本：")
        for line in changes:
            print(f"  {line}")
    else:
        print("脚本内容无变化。")
    print(f"清单：{'已更新' if manifest_changed else '无变化'}（scripts.json）")
    if readme_changed:
        print("README 脚本表格已刷新。")

    # legacy/ 里已不在远端列表的文件只做提示，不自动删除
    known = {Path(entry["file"]).name for entry in entries}
    orphans = sorted(
        item.relative_to(SCRIPTS_DIR).as_posix()
        for item in SCRIPTS_DIR.glob("*/legacy/*.user.js")
        if item.name not in known
    )
    if orphans:
        print("\n提示：以下本地文件已不在远端列表中，请确认后手动删除：")
        for name in orphans:
            print(f"  {name}")

    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="从 Greasy Fork 同步 Wildfire2282 的全部用户脚本到 monorepo。"
    )
    parser.add_argument(
        "--check", action="store_true", help="只检查更新，不写入任何文件；有更新时退出码为 1"
    )
    parser.add_argument(
        "--force", action="store_true", help="忽略内容比对，强制重新下载并重写全部脚本"
    )
    args = parser.parse_args(argv)

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    try:
        return sync(check_only=args.check, force=args.force)
    except FetchError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\n已取消。", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
