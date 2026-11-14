"""Тесты без сети: python -m unittest test_vision -v"""
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

os.environ["VISION_CACHE_DIR"] = tempfile.mkdtemp()
import vision  # noqa: E402
from PIL import Image  # noqa: E402

HERE = Path(__file__).resolve().parent


def jpeg(color=(120, 120, 120), size=(640, 480)) -> bytes:
    b = io.BytesIO()
    Image.new("RGB", size, color).save(b, "JPEG")
    return b.getvalue()


GOOD = {"equipment": "центробежный насос", "findings": [
    {"cls": "shaft_seal_leak", "confidence": 0.86, "box": [0.4, 0.45, 0.2, 0.4], "explanation": "Подтёк"},
    {"cls": "made_up_class", "confidence": 0.9, "box": [0.1, 0.1, 0.1, 0.1]},
    {"cls": "surface_corrosion", "confidence": 0.3, "box": [0.1, 0.1, 0.1, 0.1]},
    {"cls": "pipe_crack", "confidence": 0.8, "box": [1.5, 1.5, 0.2, 0.2]},
], "nodes": [{"comp": "seal", "box": [0.38, 0.42, 0.22, 0.42]}, {"comp": "wheel", "box": [0, 0, 1, 1]}]}


class TestParsing(unittest.TestCase):
    def test_extract_json_fenced(self):
        self.assertEqual(vision.extract_json('Вот:\n```json\n{"a": {"b": "}"}}\n```')["a"]["b"], "}")

    def test_extract_json_none(self):
        self.assertIsNone(vision.extract_json("не знаю"))

    def test_box_fraction(self):
        self.assertEqual(vision.normalize_box([0.1, 0.2, 0.3, 0.4]), [0.1, 0.2, 0.3, 0.4])

    def test_box_clip_small_overflow(self):
        self.assertEqual(vision.normalize_box([0.8, 0.8, 0.25, 0.25]), [0.8, 0.8, 0.2, 0.2])

    def test_box_outside(self):
        self.assertIsNone(vision.normalize_box([0.9, 0.9, 0.5, 0.5]))
        self.assertIsNone(vision.normalize_box([1.5, 1.5, 0.2, 0.2]))
        self.assertIsNone(vision.normalize_box([0.1, 0.1, 0, 0.2]))
        self.assertIsNone(vision.normalize_box("x"))

    def test_box_permille_and_pixels(self):
        self.assertEqual(vision.normalize_box([100, 200, 300, 400]), [0.1, 0.2, 0.3, 0.4])
        with mock.patch.dict(os.environ, {"VISION_BOX_UNITS": "pixel"}):
            self.assertEqual(vision.normalize_box([128, 72, 256, 144], 1280, 720)[:2], [0.1, 0.1])
            self.assertEqual(vision.normalize_box([0.1, 0.2, 0.3, 0.4], 1280, 720), [0.1, 0.2, 0.3, 0.4])
        self.assertEqual(vision.normalize_box([1100, 0, 100, 720], 1280, 720)[0], 0.8594)

    def test_box_xyxy(self):
        self.assertEqual(vision.normalize_box([0.5, 0.5, 0.9, 0.8]), [0.5, 0.5, 0.4, 0.3])

    def test_validate(self):
        resp, dropped = vision.validate(GOOD, 1280, 960)
        self.assertEqual([f["cls"] for f in resp["findings"]], ["shaft_seal_leak"])
        self.assertEqual(resp["status"], "defect")
        self.assertEqual(resp["findings"][0]["comp"], "seal")
        self.assertEqual([n["comp"] for n in resp["nodes"]], ["seal"])
        self.assertEqual(len(dropped), 4)

    def test_validate_empty_is_ok_not_healthy(self):
        resp, _ = vision.validate({"findings": [], "nodes": []})
        self.assertEqual(resp["status"], "ok")
        self.assertIn("не подтверждает", resp["disclaimer"])

    def test_classes_count(self):
        self.assertEqual(len(vision.CATALOG["classes"]), 18)


class TestPipeline(unittest.TestCase):
    def setUp(self):
        os.environ["VISION_PROVIDER"] = "anthropic"
        os.environ["ANTHROPIC_API_KEY"] = "test"

    def test_model_ok_and_cache(self):
        with mock.patch.object(vision, "call_model", return_value=json.dumps(GOOD)) as m:
            img = jpeg((10, 20, 30))
            r1 = vision.analyze_image(img, "CN-1")
            r2 = vision.analyze_image(img, "CN-1")
        self.assertEqual(r1["source"], "model")
        self.assertEqual(r2["source"], "cache")
        self.assertEqual(m.call_count, 1)
        self.assertEqual(r1["unit_id"], "CN-1")

    def test_retry_then_ok(self):
        with mock.patch.object(vision, "call_model", side_effect=["бред", json.dumps(GOOD)]) as m:
            r = vision.analyze_image(jpeg((11, 22, 33)), use_cache=False)
        self.assertEqual(m.call_count, 2)
        self.assertEqual(len(r["findings"]), 1)

    def test_two_bad_answers_gives_error(self):
        with mock.patch.object(vision, "call_model", return_value="не JSON"):
            r = vision.analyze_image(jpeg((12, 23, 34)), use_cache=False, use_demo_cache=False)
        self.assertIn("error", r)
        self.assertEqual(r["findings"], [])

    def test_network_down_uses_demo_cache(self):
        demo = json.loads((HERE / "demo_cache" / "demo.json").read_text(encoding="utf-8"))["items"][0]
        photos = os.getenv("CASE_DIR")
        if not photos:
            self.skipTest("CASE_DIR не задан")
        data = (Path(photos) / demo["file"]).read_bytes()
        # телефон пересжал фото и уменьшил вдвое
        im = Image.open(io.BytesIO(data)).convert("RGB")
        im = im.resize((im.width // 2, im.height // 2))
        b = io.BytesIO()
        im.save(b, "JPEG", quality=60)
        with mock.patch.object(vision, "call_model", side_effect=RuntimeError("нет сети")):
            r = vision.analyze_image(b.getvalue(), use_cache=False)
        self.assertEqual(r["source"], "demo_cache")
        self.assertEqual(r["findings"][0]["cls"], demo["response"]["findings"][0]["cls"])

    def test_broken_image(self):
        r = vision.analyze_image(b"not an image")
        self.assertIn("error", r)


class FakeDetector:
    @staticmethod
    def detect(jpeg):
        return [{"cls": "pipe_crack", "confidence": 0.7, "box": [0.1, 0.1, 0.2, 0.2], "by": "detector"},
                {"cls": "shaft_seal_leak", "confidence": 0.6, "box": [0.41, 0.46, 0.2, 0.4], "by": "detector"}]


class TestDetectorMerge(unittest.TestCase):
    def setUp(self):
        os.environ["VISION_PROVIDER"] = "anthropic"
        os.environ["ANTHROPIC_API_KEY"] = "test"

    def test_hybrid_merge(self):
        with mock.patch.object(vision, "call_model", return_value=json.dumps(GOOD)), \
             mock.patch.object(vision, "_detector", return_value=FakeDetector):
            r = vision.analyze_image(jpeg((44, 55, 66)), use_cache=False)
        by = {f["cls"]: f["by"] for f in r["findings"]}
        self.assertEqual(by, {"shaft_seal_leak": "model+detector", "pipe_crack": "detector"})
        self.assertEqual(r["status"], "defect")

    def test_yolo_only(self):
        with mock.patch.object(vision, "_detector", return_value=FakeDetector):
            r = vision.analyze_image(jpeg((45, 55, 66)), provider="yolo")
        self.assertEqual(r["source"], "detector")
        self.assertEqual(len(r["findings"]), 2)

    def test_yolo_without_weights(self):
        with mock.patch.object(vision, "_detector", return_value=None):
            r = vision.analyze_image(jpeg((46, 55, 66)), provider="yolo")
        self.assertIn("error", r)


class TestOffline(unittest.TestCase):
    def test_rust_detected_on_rusty_texture(self):
        import random
        random.seed(1)
        im = Image.new("RGB", (400, 300), (90, 90, 95))
        px = im.load()
        for y in range(60, 240):
            for x in range(80, 300):
                k = random.randint(-40, 40)
                px[x, y] = (max(0, 150 + k), max(0, 75 + k // 2), max(0, 30 + k // 4))
        b = io.BytesIO()
        im.save(b, "JPEG")
        from cv_rust import detect_rust
        f = detect_rust(b.getvalue())
        self.assertTrue(f and f[0]["cls"] == "surface_corrosion")
        x, y, w, h = f[0]["box"]
        self.assertAlmostEqual(x, 0.2, delta=0.06)
        self.assertAlmostEqual(w, 0.55, delta=0.08)

    def test_grey_has_no_rust(self):
        from cv_rust import detect_rust
        self.assertEqual(detect_rust(jpeg()), [])


if __name__ == "__main__":
    unittest.main()
