# 本地测量台服务器：静态文件 + COOP/COEP + 按路径统计下发字节
#
# 为什么必须自己起：
#   1) 线上是 HTTPS + COOP/COEP，页面才有 crossOriginIsolated / SharedArrayBuffer。
#      用裸 http.server 就没有这两个头，模型跑在单线程降级路径上，耗时跟线上对不上。
#   2) "首次要下载多少兆" 要的是真实下发字节 —— 服务端自己数最准，
#      不依赖 CDP 抓包（CDP 在 worker 上抓不全，已踩过）。
#
# 用法: python serve-ab.py <端口> <根目录>
# 它会把每次请求的字节数累加写进同目录的 bytes.log，并持续更新 bytes.json
import json, os, sys, threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1])
ROOT = os.path.abspath(sys.argv[2]).replace("\\", "/")
LOG_PATH = os.path.join(ROOT, "..", "bytes.json")

ISOLATION = [
    ("Cross-Origin-Opener-Policy", "same-origin"),
    ("Cross-Origin-Embedder-Policy", "require-corp"),
    ("Cross-Origin-Resource-Policy", "cross-origin"),
]

lock = threading.Lock()
totals = {"models": {}, "all": 0, "by_ext": {}}


def bump(bucket, key, n):
    with lock:
        totals[bucket][key] = totals[bucket].get(key, 0) + n
        # 注意：models 桶和 by_ext 桶会对同一个文件各记一次，
        # 所以 all 不能在这里累加，否则模型文件会被算两遍。
        totals["all"] = sum(totals["by_ext"].values())
        try:
            with open(LOG_PATH, "w", encoding="utf-8") as f:
                json.dump(totals, f)
        except Exception:
            pass


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        for k, v in ISOLATION:
            self.send_header(k, v)
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_head(self):
        # 先让父类算好，再按实际发送量记账；sendfile 走 copyfile 分支
        path = self.translate_path(self.path)
        size = 0
        try:
            if os.path.isfile(path):
                size = os.path.getsize(path)
        except Exception:
            size = 0
        rel = os.path.relpath(path, ROOT).replace("\\", "/")
        if rel.startswith("models/"):
            parts = rel.split("/")
            model = parts[1] if len(parts) > 1 else "?"
            bump("models", model, size)
        ext = os.path.splitext(rel)[1] or "(none)"
        bump("by_ext", ext, size)
        return super().send_head()

    def log_message(self, fmt, *args):
        # 默认 http.server 把每条请求打成 "127.0.0.1 - - [...]  GET ... 200 -"
        # —— 隐私/跨源审计需要它，原版写 pass 是为了不污染终端。
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))
        sys.stderr.flush()


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    sys.stderr.write(f"serving {ROOT} on {PORT}\n")
    srv.serve_forever()
