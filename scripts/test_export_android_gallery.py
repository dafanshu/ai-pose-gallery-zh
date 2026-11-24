"""Offline exporter tests; run with python -m unittest discover -s scripts -p test_export_android_gallery.py."""
import base64
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile, ZIP_STORED

from PIL import Image

spec = importlib.util.spec_from_file_location("export_android_gallery", Path(__file__).with_name("export-android-gallery.py"))
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class AndroidGalleryExportTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name) / "gallery"
        for directory in ("data", "img", "thumbs"):
            (self.root / directory).mkdir(parents=True)

    def jpg(self, relative, color="teal", mode="RGB", size=(16, 24)):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new(mode, size, color).save(path)

    def catalog(self, filename, rows):
        (self.root / "data" / filename).write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8-sig")

    def test_all_three_categories_including_webp_or_png_fallback_and_metadata(self):
        self.jpg("img/portrait/01.png")
        self.jpg("img/costume/02.webp")
        self.jpg("thumbs/03.jpg", size=(1000, 500))
        self.catalog("portrait-zh.json", [{"id": "01", "标题": "有\n刘海", "分区": "女性", "原图": "img/portrait/01.webp"}])
        self.catalog("costume-shisei-zh.json", [{"id": "02", "服装名称": "宋制", "分类": "中国历代", "标签": ["女装", "女装"], "预览图": "/img/costume/02.webp"}])
        self.catalog("pose-zh.json", [{"id": "03", "姿势名称": "走路", "角度": "斜侧", "缩略图": "thumbs/03.jpg"}])
        payload, counts = exporter.make_pack(self.root, edge=512)
        manifest = json.loads(payload)
        self.assertEqual(("role-studio-gallery", 1), (manifest["format"], manifest["version"]))
        self.assertEqual(["人像", "服饰", "姿势"], [exporter.LABELS[i["slot"]] for i in manifest["items"]])
        self.assertEqual(["有 刘海", "宋制", "走路 · 斜侧"], [i["name"] for i in manifest["items"]])
        self.assertEqual(["中国历代", "02", "女装"], manifest["items"][1]["tags"])
        self.assertTrue(all(counts[k]["added"] == 1 for k in counts))
        for item in manifest["items"]:
            self.assertTrue(item["dataUrl"].startswith("data:image/jpeg;base64,"))
            with Image.open(io.BytesIO(base64.b64decode(item["dataUrl"].split(",", 1)[1], validate=True))) as image:
                self.assertEqual(image.format, "JPEG")
                self.assertLessEqual(max(image.size), 512)
                self.assertEqual(len(image.getexif()), 0)

    def test_remote_invalid_traversal_sensitive_are_skipped_and_empty_fails(self):
        self.jpg("../outside.jpg")
        self.jpg("img/valid.jpg")
        self.catalog("costume-zh.json", [
            {"服装名称": "远程", "原图": "https://example.invalid/img/remote.png"},
            {"服装名称": "越界", "原图": "img/../../outside.jpg"},
            {"服装名称": "敏感", "分类": "内衣・睡衣", "原图": "img/valid.jpg"},
        ])
        self.catalog("pose-zh.json", [{"姿势名称": "测试", "体系": "双人缠绵", "原图": "img/valid.jpg"}])
        with self.assertRaisesRegex(ValueError, "没有可导出"):
            exporter.make_pack(self.root)
        self.catalog("portrait-zh.json", [{"发型名称": "短发", "原图": "img/valid.jpg"}])
        payload, counts = exporter.make_pack(self.root)
        self.assertEqual(1, len(json.loads(payload)["items"]))
        self.assertEqual(2, counts["costume"]["missing"])
        self.assertEqual(1, counts["costume"]["sensitive"])
        self.assertEqual(1, counts["pose"]["sensitive"])

    def test_size_and_category_balance(self):
        self.jpg("img/basic.jpg")
        for slot, filename in zip(exporter.SOURCES, ("portrait-zh.json", "costume-zh.json", "pose-zh.json")):
            self.catalog(filename, [
                {"id": str(i), "分类": "甲" if i < 3 else "乙", "分区": "甲" if i < 3 else "乙", "原图": "img/basic.jpg"}
                for i in range(4)
            ])
        payload, counts = exporter.make_pack(self.root, per_kind=2, budget=5000)
        self.assertLessEqual(len(payload), 5000)
        self.assertEqual([2, 2, 2], [summary["added"] for summary in counts.values()])
        for kind in exporter.SOURCES:
            subset = [row for row in json.loads(payload)["items"] if row["slot"] == kind]
            self.assertEqual(["0", "3"], [row["name"] for row in subset])
        with self.assertRaisesRegex(ValueError, "没有可导出"):
            exporter.make_pack(self.root, budget=200)


    def test_zip_contains_metadata_and_independent_jpegs_without_old_item_caps(self):
        self.jpg("img/base.png", size=(1250, 700))
        self.jpg("thumbs/small.webp")
        self.catalog("portrait-zh.json", [{"id": "portrait", "标题": "测试人像", "原图": "img/base.png"}])
        self.catalog("costume-zh.json", [{"id": str(i), "服装名称": f"服装 {i}", "缩略图": "thumbs/small.webp"} for i in range(610)])
        self.catalog("pose-zh.json", [
            {"id": "ok", "姿势名称": "跑步", "角度": "侧面", "原图": "img/base.png"},
            {"id": "skip", "原图": "https://example.invalid/skip.png"},
        ])
        output = self.root / "mobile.zip"
        info = exporter.make_zip_pack(self.root, output, edge=1024)
        self.assertEqual([1, 610, 1], [row["added"] for row in info.values()])
        self.assertEqual(1, info["pose"]["missing"])
        with ZipFile(output) as archive:
            self.assertIsNone(archive.testzip())
            manifest = json.loads(archive.read("manifest.json"))
            self.assertEqual(("role-studio-gallery-zip", 1), (manifest["format"], manifest["version"]))
            self.assertEqual(612, len(manifest["items"]))
            self.assertEqual(set(range(1, 613)), {item["id"] for item in manifest["items"]})
            self.assertEqual(2 * 612 + 1, len(archive.infolist()))
            self.assertTrue(all(member.compress_type == ZIP_STORED for member in archive.infolist()))
            self.assertNotIn("dataUrl", manifest["items"][0])
            for filename, limit in (("images/1.jpg", 1024), ("thumbs/1.jpg", 320)):
                with Image.open(io.BytesIO(archive.read(filename))) as image:
                    self.assertEqual(image.format, "JPEG")
                    self.assertEqual(max(image.size), limit)

    def test_zip_never_overwrites_or_leaves_failed_pack(self):
        self.jpg("img/basic.jpg")
        self.catalog("portrait-zh.json", [{"id": "1", "原图": "img/basic.jpg"}])
        output = self.root / "mobile.zip"
        with self.assertRaisesRegex(ValueError, "超过上限"):
            exporter.make_zip_pack(self.root, output, budget=1)
        self.assertFalse(output.exists())
        output.write_bytes(b"existing")
        with self.assertRaises(FileExistsError):
            exporter.make_zip_pack(self.root, output)
        self.assertEqual(b"existing", output.read_bytes())


if __name__ == "__main__":
    unittest.main()
