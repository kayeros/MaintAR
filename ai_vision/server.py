"""
Сервис анализа фото: POST /analyze.

Запуск:
    python server.py                 # порт 8001, слушает все интерфейсы
    PORT=8000 python server.py

Если установлены fastapi, uvicorn и python-multipart, поднимается FastAPI
(есть /docs). Если нет, работает встроенный сервер на стандартной библиотеке
с тем же API, чтобы демо не зависело от pip.

Методы:
    POST /analyze       multipart: photo (файл), unit_id (строка)
    POST /analyze_json  JSON: {"image_base64": "...", "unit_id": "CN-1"}
                     параметры запроса у обоих: ?provider=anthropic|openai|offline, ?nocache=1
    GET  /classes    справочник классов и узлов
    GET  /health     состояние и текущий провайдер
"""
from __future__ import annotations

import base64
import json
import os
import sys
from email.parser import BytesParser
from email.policy import HTTP
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from vision import CATALOG, analyze_image, provider_config

MAX_UPLOAD = 15 * 1024 * 1024
PORT = int(os.getenv("PORT", "8001"))


def health() -> dict:
    cfg = provider_config()
    return {"ok": True, "provider": cfg["provider"], "model": cfg["model"],
            "classes_source": CATALOG["source"], "classes": len(CATALOG["classes"]),
            "demo_mode": os.getenv("VISION_DEMO_MODE", "0") == "1"}


def classes() -> dict:
    return {"classes": CATALOG["classes"], "components": CATALOG["components"],
            "statuses": CATALOG["statuses"]}


def run_analyze(data: bytes, unit_id: str | None, provider: str | None, nocache: bool) -> dict:
    return analyze_image(data, unit_id, use_cache=not nocache, provider=provider)


# ---------------------------------------------------------------- FastAPI

def build_fastapi():
    from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
    from fastapi.middleware.cors import CORSMiddleware

    app = FastAPI(title="Pump vision /analyze", version="1.0")
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    @app.get("/health")
    def _health():
        return health()

    @app.get("/classes")
    def _classes():
        return classes()

    @app.post("/analyze")
    async def _analyze(photo: UploadFile = File(...), unit_id: str | None = Form(None),
                       provider: str | None = None, nocache: int = 0):
        data = await photo.read()
        if not data or len(data) > MAX_UPLOAD:
            raise HTTPException(400, "Пустой или слишком большой файл")
        return run_analyze(data, unit_id, provider, bool(nocache))

    @app.post("/analyze_json")
    async def _analyze_json(request: Request, provider: str | None = None, nocache: int = 0):
        try:
            body = await request.json()
            data = base64.b64decode(body["image_base64"].split(",")[-1])
        except Exception:
            raise HTTPException(400, "Нужно поле image_base64")
        if not data or len(data) > MAX_UPLOAD:
            raise HTTPException(400, "Пустой или слишком большой файл")
        return run_analyze(data, body.get("unit_id"), provider, bool(nocache))

    return app


# ---------------------------------------------------------------- stdlib

def parse_multipart(body: bytes, content_type: str) -> dict:
    msg = BytesParser(policy=HTTP).parsebytes(
        b"Content-Type: " + content_type.encode() + b"\r\nMIME-Version: 1.0\r\n\r\n" + body)
    out = {}
    for part in msg.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if name:
            out[name] = part.get_payload(decode=True) or b""
    return out


class Handler(BaseHTTPRequestHandler):
    server_version = "pump-vision/1.0"

    def _send(self, code: int, obj: dict):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            return self._send(200, health())
        if path == "/classes":
            return self._send(200, classes())
        self._send(404, {"error": "not found"})

    def do_POST(self):
        url = urlparse(self.path)
        if url.path not in ("/analyze", "/analyze_json"):
            return self._send(404, {"error": "not found"})
        q = parse_qs(url.query)
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_UPLOAD:
            return self._send(400, {"error": "Пустой или слишком большой запрос"})
        body = self.rfile.read(n)
        ctype = self.headers.get("Content-Type", "")
        try:
            if ctype.startswith("multipart/form-data"):
                fields = parse_multipart(body, ctype)
                data = fields.get("photo") or fields.get("file") or b""
                unit_id = (fields.get("unit_id") or b"").decode() or None
            else:
                js = json.loads(body)
                data = base64.b64decode(js["image_base64"].split(",")[-1])
                unit_id = js.get("unit_id")
        except Exception as e:
            return self._send(400, {"error": f"Не разобран запрос: {e}"})
        if not data:
            return self._send(400, {"error": "Нет поля photo"})
        resp = run_analyze(data, unit_id, (q.get("provider") or [None])[0],
                           (q.get("nocache") or ["0"])[0] == "1")
        self._send(200, resp)

    def log_message(self, fmt, *args):
        sys.stderr.write("[analyze] " + fmt % args + "\n")


def main():
    h = health()
    print(f"provider={h['provider']} model={h['model']} классы={h['classes']} ({h['classes_source']})")
    if os.getenv("VISION_STDLIB", "0") != "1":
        try:
            import uvicorn
            app = build_fastapi()
            print(f"FastAPI на http://0.0.0.0:{PORT}  (документация /docs)")
            uvicorn.run(app, host="0.0.0.0", port=PORT)
            return
        except ImportError:
            print("fastapi/uvicorn не установлены, запускаю встроенный сервер")
    print(f"Встроенный сервер на http://0.0.0.0:{PORT}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
