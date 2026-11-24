#!/usr/bin/env python3
"""从已有 ai-pose-gallery-zh 目录制作个人使用的安卓离线图库包。不下载素材。"""
import argparse
import base64
import io
import json
import re
import sys
import unicodedata
from collections import Counter, deque
from itertools import chain
from pathlib import Path, PurePosixPath

from PIL import Image, ImageOps


MIB = 1024 * 1024
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


def rows_for(root, slot):
    for name in SOURCES[slot]:
        catalog = rooted_file(root, f"data/{name}", {"data"})
        if catalog is None:
            continue
        with catalog.open("rb") as handle:
            source = handle.read(16 * MIB + 1)
        if len(source) > 16 * MIB:
            raise ValueError(f"{name} 超过 16 MiB")
        rows = json.loads(source.decode("utf-8-sig"))
        if not isinstance(rows, list):
            raise ValueError(f"{name} 不是图库索引列表")
        yield from (row for row in rows if isinstance(row, dict))


def metadata(slot, row):
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


def compact_image(path, edge):
    try:
        with path.open("rb") as handle:
            original = handle.read(16 * MIB + 1)
        if len(original) > 16 * MIB:
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
            output = io.BytesIO()
            rgb.save(output, format="JPEG", quality=84, optimize=True)
            return output.getvalue()
    except (OSError, ValueError, Image.DecompressionBombError):
        return None


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
    parser.add_argument("output", type=Path, help="生成的 .json 素材包路径")
    parser.add_argument("--per-kind", type=int, default=100, help="每类最多 1–200 项，默认 100")
    parser.add_argument("--edge", type=int, default=768, help="参考图最长边，384–1280 像素，默认 768")
    args = parser.parse_args()
    try:
        if args.output.suffix.lower() != ".json":
            raise ValueError("请将输出文件命名为 .json")
        pack, summaries = make_pack(args.gallery_root, args.per_kind, args.edge)
        with args.output.open("xb") as handle:
            handle.write(pack)
    except (OSError, ValueError) as error:
        parser.exit(1, f"导出失败：{error}\n")
    for slot, counts in summaries.items():
        print(f"{LABELS[slot]}：导出 {counts['added']}；选取范围外 {counts['over_limit']}；"
              f"缺少有效本地图或远程条目 {counts['missing']}；跳过敏感 {counts['sensitive']}")
    print(f"已写入 {args.output}（{len(pack) / MIB:.1f} MiB），可传到手机后从 App 导入。")


if __name__ == "__main__":
    main()
