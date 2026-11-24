#!/usr/bin/env python3
"""从已有 ai-pose-gallery-zh 目录制作个人使用的安卓离线图库包。全程只读取本机文件，ZIP 缺图即终止。"""
import argparse
import base64
import io
import json
import os
import re
import tempfile
import sys
import unicodedata
import zipfile
from collections import Counter, deque
from itertools import chain
from pathlib import Path, PurePosixPath

from PIL import Image, ImageOps


MIB = 1024 * 1024
ZIP_MAX_BYTES = 2 * 1024 * MIB
ZIP_MAX_IMAGE = 5 * MIB
ZIP_MAX_THUMB = 128 * 1024
ZIP_MAX_MANIFEST = 4 * MIB
ZIP_MAX_ITEMS = 10_000
MAX_SOURCE_IMAGE = 16 * MIB
ZIP_FORMAT = "role-studio-gallery-zip"
PREFIX = b'{"format":"role-studio-gallery","version":1,"items":['
SUFFIX = b']}\n'
SOURCES = {
    "portrait": ("portrait-zh.json",),
    "costume": ("costume-zh.json", "costume-shisei-zh.json", "costume-anime-zh.json", "costume-gia-anime-zh.json"),
    "pose": ("pose-zh.json",),
}
NAME_FIELDS = {"portrait": ("标题", "发型名称"), "costume": ("服装名称",), "pose": ("姿势名称",)}
LABELS = {"portrait": "人像", "costume": "服饰", "pose": "姿势"}
SENSITIVE_POSES = {"全身单人・性感系", "双人缠绵"}
SENSITIVE_COSTUMES = {"内衣・睡衣", "性感穿搭"}
MEDIA_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def clean(value, limit):
    if not isinstance(value, str):
        return ""
    controls_removed = "".join(" " if unicodedata.category(ch).startswith("C") else ch for ch in value)
    text = " ".join(controls_removed.split())
    return text.encode("utf-16-le")[: 2 * limit].decode("utf-16-le", "ignore")


def rooted_file(root, relative, folders):
    if not isinstance(relative, str) or not relative or "\\" in relative or ":" in relative:
        return None
    try:
        path = PurePosixPath(relative.lstrip("/"))
        if not path.parts or path.parts[0] not in folders or ".." in path.parts:
            return None
        target = (root / path).resolve()
        resolved_relative = target.relative_to(root)
        return target if resolved_relative.parts[0] in folders and target.is_file() else None
    except (IndexError, OSError, RuntimeError, ValueError):
        return None


def catalog_rows(root, name):
    catalog = rooted_file(root, f"data/{name}", {"data"})
    if catalog is None:
        raise ValueError(f"缺少图库索引 data/{name}")
    with catalog.open("rb") as handle:
        source = handle.read(16 * MIB + 1)
    if len(source) > 16 * MIB:
        raise ValueError(f"{name} 超过 16 MiB")
    try:
        rows = json.loads(source.decode("utf-8-sig"))
    except (ValueError, UnicodeError):
        raise ValueError(f"{name} 不是有效的 UTF-8 JSON") from None
    if not isinstance(rows, list):
        raise ValueError(f"{name} 不是图库索引列表")
    return rows


def rows_for(root, slot):
    for name in SOURCES[slot]:
        if rooted_file(root, f"data/{name}", {"data"}) is not None:
            yield from (row for row in catalog_rows(root, name) if isinstance(row, dict))


def metadata(slot, row, *, zip_labels=False):
    name = next((name for field in NAME_FIELDS[slot] if (name := clean(row.get(field), 100))), "")
    if not name:
        name = clean(row.get("id"), 100)
    if not name:
        return None
    if slot == "pose":
        angle = clean(row.get("角度"), 18)
        if angle:
            name = clean(f"{name} · {angle}", 120)
    raw_tags = row.get("标签")
    if not isinstance(raw_tags, list):
        raw_tags = []
    fields = ("分类", "分区", "发长", "体系", "角度", "姿势编号", "一级分类", "来源", "id")
    tags = list(dict.fromkeys(
        clean(value, 60) for value in chain((row.get(field) for field in fields), raw_tags)
    ))
    if zip_labels and row.get("敏感") is True:
        tags = ["敏感", *(tag for tag in tags if tag != "敏感")]
    return name, [tag for tag in tags if tag][:12]


def fair_candidates(root, slot, counters):
    groups = {}
    for row in rows_for(root, slot):
        counters["scanned"] += 1
        if (slot == "pose" and clean(row.get("体系"), 60) in SENSITIVE_POSES
                or slot == "costume" and (row.get("敏感") or clean(row.get("分类"), 60) in SENSITIVE_COSTUMES)):
            counters["sensitive"] += 1
            continue
        if slot == "portrait":
            group = (clean(row.get("分区"), 60), clean(row.get("发长"), 60))
        elif slot == "pose":
            group = (clean(row.get("体系"), 60), clean(row.get("分类"), 60))
        else:
            group = (clean(row.get("分类"), 60), clean(row.get("source"), 60))
        groups.setdefault(group, deque()).append(row)
    remaining = deque(groups.values())
    while remaining:
        queue = remaining.popleft()
        yield queue.popleft()
        if queue:
            remaining.append(queue)


def image_candidates(root, row):
    seen = set()
    for field in ("原图", "预览图", "缩略图"):
        path = row.get(field)
        if not isinstance(path, str):
            continue
        # Translated clothing/portrait indexes often point at WebP, while full-size
        # local copies in the same directory can also exist as PNG.
        paths = (path, str(PurePosixPath(path).with_suffix(".png"))) if path.lower().endswith(".webp") else (path,)
        for relative in paths:
            target = rooted_file(root, relative, {"img", "thumbs"})
            if target is None or target.suffix.lower() not in MEDIA_SUFFIXES or target in seen:
                continue
            seen.add(target)
            yield target


def decode_gallery_image(original, edge):
    try:
        if len(original) > MAX_SOURCE_IMAGE:
            return None
        with Image.open(io.BytesIO(original), formats=("JPEG", "PNG", "WEBP")) as image:
            if image.width * image.height > 32_000_000 or getattr(image, "is_animated", False):
                return None
            image = ImageOps.exif_transpose(image)
            image.thumbnail((edge, edge), Image.Resampling.LANCZOS)
            rgb = image.convert("RGB")
            if "A" in image.getbands() or "transparency" in image.info:
                rgba = image.convert("RGBA")
                rgb = Image.new("RGB", rgba.size, "white")
                rgb.paste(rgba, mask=rgba.getchannel("A"))
            return rgb
    except (OSError, ValueError, Image.DecompressionBombError):
        return None


def load_gallery_image(path, edge):
    try:
        with path.open("rb") as handle:
            return decode_gallery_image(handle.read(MAX_SOURCE_IMAGE + 1), edge)
    except OSError:
        return None


def asset_origin(catalog, row):
    row_id = row.get("id")
    if not isinstance(row_id, str):
        return None
    if catalog == "costume-anime-zh.json" and row.get("source") == "charadb" and re.fullmatch(r"charadb-O[0-9]{3}", row_id):
        return "charadb", row_id.removeprefix("charadb-")
    if catalog == "costume-gia-anime-zh.json" and row.get("source") == "gia-anime" and re.fullmatch(r"gia-anime-[A-Za-z0-9][A-Za-z0-9_-]{0,63}", row_id):
        return "gia", row_id.removeprefix("gia-anime-")
    return None


def package_candidates(package, provider, asset):
    layouts = {
        "charadb": (("img", ".jpg"), ("thumb", ".webp")),
        "gia": (("png", ".png"), ("img", ".webp"), ("thumbs", ".webp")),
    }
    seen = set()
    for folder, ext in layouts[provider]:
        candidate = rooted_file(package, f"{folder}/{asset}{ext}", {folder})
        if candidate is not None and candidate not in seen:
            seen.add(candidate)
            yield candidate
    for ext in (".png", ".jpg", ".jpeg", ".webp"):
        # Filenames are synthesized from an exact, validated catalog ID.
        try:
            candidate = (package / f"{asset}{ext}").resolve()
            if candidate.parent == package and candidate.is_file() and candidate not in seen:
                seen.add(candidate)
                yield candidate
        except (OSError, RuntimeError, ValueError):
            continue


def row_image(root, catalog, row, edge, source_dirs):
    found_local = False
    for candidate in image_candidates(root, row):
        found_local = True
        if (image := load_gallery_image(candidate, edge)) is not None:
            return image, "local"
    origin = asset_origin(catalog, row)
    if origin is not None:
        provider, asset = origin
        option = f"--{provider}-dir"
        package = source_dirs.get(provider)
        if package is None:
            return None, f"缺本地授权素材，请用 {option} 指定已合法取得的目录"
        for candidate in package_candidates(package, provider, asset):
            found_local = True
            if (image := load_gallery_image(candidate, edge)) is not None:
                return image, provider
        return None, f"{option} 中相应 ID 图片无法解码" if found_local else f"{option} 中缺少相应 ID 图片"
    fields = (row.get(field) for field in ("原图", "预览图", "缩略图"))
    if any(isinstance(raw, str) and raw.lower().startswith(("http:", "https:", "//")) for raw in fields):
        return None, "没有可按索引 ID 匹配的本地文件，脚本不会访问外链"
    return None, "本地图片无法解码" if found_local else "本地图片缺失"


def row_location(catalog, line, row):
    ident = row.get("id") if isinstance(row, dict) else None
    if not isinstance(ident, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}", ident):
        ident = "无安全 ID"
    return f"{catalog} 第 {line} 项 (ID: {ident})"


def jpeg(image, quality):
    output = io.BytesIO()
    image.save(output, format="JPEG", quality=quality, optimize=True)
    return output.getvalue()


def compact_image(path, edge):
    image = load_gallery_image(path, edge)
    return jpeg(image, 84) if image is not None else None


def make_zip_pack(root, output, per_kind=None, edge=1024, *, budget=ZIP_MAX_BYTES, progress=False, charadb_dir=None, gia_dir=None):
    """Full catalog export: an unresolved row makes the entire package fail."""
    if per_kind is not None:
        raise ValueError("ZIP 必须全量导出，--per-kind 仅用于旧 JSON")
    if not 384 <= edge <= 1280:
        raise ValueError("参考图长边应在 384–1280 像素")
    if not 1 <= budget <= ZIP_MAX_BYTES:
        raise ValueError("无效 ZIP 限额")
    root = root.resolve(strict=True)
    if output.exists():
        raise FileExistsError(f"目标已存在：{output}")
    missing = [name for names in SOURCES.values() for name in names
               if rooted_file(root, f"data/{name}", {"data"}) is None]
    if missing:
        raise ValueError("缺少图库索引：" + "、".join(f"data/{name}" for name in missing))
    summaries, items, failures = {}, [], []
    image_bytes = 0
    source_dirs = {}
    for provider, folder in (("charadb", charadb_dir), ("gia", gia_dir)):
        if folder is not None:
            root_folder = folder.resolve()
            if not root_folder.is_dir():
                raise ValueError(f"--{provider}-dir 必须指向已解压的本机素材目录")
            source_dirs[provider] = root_folder
    fd, temp = tempfile.mkstemp(prefix=f".{output.name}.", suffix=".tmp", dir=output.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            with zipfile.ZipFile(handle, "w", compression=zipfile.ZIP_STORED, allowZip64=False) as archive:
                for slot, names in SOURCES.items():
                    counters = summaries[slot] = Counter()
                    for catalog in names:
                        for line, row in enumerate(catalog_rows(root, catalog), 1):
                            counters["scanned"] += 1
                            location = row_location(catalog, line, row)
                            info = metadata(slot, row, zip_labels=True) if isinstance(row, dict) else None
                            if info is None:
                                failures.append((location, "记录不是对象或缺少名称和 ID"))
                                continue
                            name, tags = info
                            image, source = row_image(root, catalog, row, edge, source_dirs)
                            if image is None:
                                failures.append((location, source))
                                continue
                            if len(items) >= ZIP_MAX_ITEMS:
                                raise ValueError("有效图库超过 10000 项；未生成 ZIP")
                            full = jpeg(image, 88)
                            image.thumbnail((320, 320), Image.Resampling.LANCZOS)
                            thumbnail = jpeg(image, 76)
                            if len(full) > ZIP_MAX_IMAGE or len(thumbnail) > ZIP_MAX_THUMB:
                                failures.append((location, "图片超过 ZIP 规格，请用 --edge 调小参考图"))
                                continue
                            image_bytes += len(full) + len(thumbnail)
                            if image_bytes >= budget:
                                raise ValueError("ZIP 将超过上限；未生成 ZIP，可用 --edge 降低大小")
                            ident = len(items) + 1
                            archive.writestr(f"images/{ident}.jpg", full)
                            archive.writestr(f"thumbs/{ident}.jpg", thumbnail)
                            items.append({"id": ident, "slot": slot, "name": name, "tags": tags})
                            counters["added"] += 1
                            counters[source] += 1
                            if progress and len(items) % 250 == 0:
                                print(f"已处理 {len(items)} 项…", file=sys.stderr)
                if failures:
                    kinds = Counter(reason for _, reason in failures)
                    summary = "；".join(f"{reason} {count} 项" for reason, count in kinds.items())
                    details = "\n".join(f"  {location}：{reason}" for location, reason in failures)
                    raise ValueError(f"{len(failures)} 项无法导出（{summary}）。未生成 ZIP。\n{details}")
                if not items:
                    raise ValueError("图库索引为空；未生成 ZIP")
                manifest = json.dumps({"format": ZIP_FORMAT, "version": 1, "items": items},
                                      ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                if len(manifest) > ZIP_MAX_MANIFEST:
                    raise ValueError("ZIP 索引超过 4 MiB；未生成 ZIP")
                archive.writestr("manifest.json", manifest)
            if handle.tell() > budget:
                raise ValueError("ZIP 超过上限；未生成 ZIP")
        # Publish a complete file only, without overwriting an existing archive.
        # Windows rename is exclusive; POSIX link gives the same semantics.
        if os.name == "nt":
            os.rename(temp, output)
        else:
            os.link(temp, output)
    finally:
        Path(temp).unlink(missing_ok=True)
    return summaries


def make_pack(root, per_kind=100, edge=768, *, budget=40 * MIB):
    if not 1 <= per_kind <= 200 or not 384 <= edge <= 1280:
        raise ValueError("每类数量应在 1–200，长边应在 384–1280 像素")
    root = root.resolve(strict=True)
    outputs = []
    summaries = {}
    # Reserve each category fair space so a large portrait catalog cannot crowd
    # costumes or poses out of the payload.
    slot_budget = (budget - len(PREFIX) - len(SUFFIX)) // len(SOURCES)
    for slot in SOURCES:
        counters = Counter()
        summaries[slot] = counters
        used = 0
        seen = set()
        for row in fair_candidates(root, slot, counters):
            info = metadata(slot, row)
            if info is None:
                counters["missing"] += 1
                continue
            name, tags = info
            row_key = (clean(row.get("source"), 60), clean(row.get("id"), 120) or name)
            if row_key in seen:
                continue
            if counters["added"] >= per_kind:
                counters["over_limit"] += 1
                continue
            image = next((image for path in image_candidates(root, row)
                          if (image := compact_image(path, edge)) is not None), None)
            if image is None:
                counters["missing"] += 1
                continue
            item = {"slot": slot, "name": name, "tags": tags,
                    "dataUrl": "data:image/jpeg;base64," + base64.b64encode(image).decode("ascii")}
            item_json = json.dumps(item, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            if used + len(item_json) + 1 > slot_budget:
                counters["over_limit"] += 1
                continue
            used += len(item_json) + 1
            outputs.append(item_json)
            seen.add(row_key)
            counters["added"] += 1
    if not outputs:
        raise ValueError("没有可导出的本地图片。请确认所选目录含 data、img 或 thumbs，并已下载图库文件。")
    return PREFIX + b",".join(outputs) + SUFFIX, summaries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("gallery_root", type=Path, help="完整图库的根目录，含 data、img 和 thumbs")
    parser.add_argument("output", type=Path, help="生成的 .zip 路径；.json 后缀表示旧的小素材包")
    parser.add_argument("--per-kind", type=int, help="旧 JSON 每类上限（默认 100）；ZIP 不允许限制数量")
    parser.add_argument("--edge", type=int, help="参考图最长边 384–1280 像素：ZIP 默认 1024，旧 JSON 默认 768")
    parser.add_argument("--charadb-dir", type=Path, help="仅 ZIP：已合法取得且允许本地保存的 CharaDB 素材解压目录")
    parser.add_argument("--gia-dir", type=Path, help="仅 ZIP：已合法取得且允许本地保存的ギア动漫服装素材解压目录")
    args = parser.parse_args()
    try:
        suffix = args.output.suffix.lower()
        if suffix == ".zip":
            summaries = make_zip_pack(args.gallery_root, args.output, args.per_kind, 1024 if args.edge is None else args.edge, progress=True, charadb_dir=args.charadb_dir, gia_dir=args.gia_dir)
        elif suffix == ".json":
            if args.charadb_dir is not None or args.gia_dir is not None:
                raise ValueError("额外本地授权素材目录仅用于 ZIP")
            pack, summaries = make_pack(args.gallery_root, 100 if args.per_kind is None else args.per_kind, 768 if args.edge is None else args.edge)
            with args.output.open("xb") as handle:
                handle.write(pack)
        else:
            raise ValueError("请将输出文件命名为 .zip（兼容旧 .json）")
        size = args.output.stat().st_size
    except (OSError, ValueError, zipfile.LargeZipFile) as error:
        parser.exit(1, f"导出失败：{error}\n")
    for slot, counts in summaries.items():
        if suffix == ".zip":
            print(f"{LABELS[slot]}：目录 {counts['scanned']} 项，导出 {counts['added']}（原图库 {counts['local']}，CharaDB 本地包 {counts['charadb']}，ギア本地包 {counts['gia']}）。")
            continue
        print(f"{LABELS[slot]}：导出 {counts['added']}；选取范围外 {counts['over_limit']}；"
              f"缺少有效本地图或远程条目 {counts['missing']}；跳过敏感 {counts['sensitive']}")
    print(f"已写入 {args.output}（{size / MIB:.1f} MiB），可传到手机后从 App 导入。")


if __name__ == "__main__":
    main()
