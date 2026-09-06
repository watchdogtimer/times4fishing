"""Static file server for local development.

Identical to `python3 -m http.server` except that it tells the browser not to
cache anything. The stock server sends no cache headers at all, so browsers
apply heuristic freshness and will happily keep running a stale ES module after
you've edited it — which looks exactly like a code bug and isn't one.
"""

import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
    http.server.test(HandlerClass=NoCacheHandler, port=port, bind="127.0.0.1")
