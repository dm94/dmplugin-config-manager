import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PROFILES = ["config", "doors", "paladio"]
RESOURCES = {
    "bot://profiles": {"profiles": PROFILES},
    "bot://status": {"running": True, "map_name": "1-5"},
    "bot://hero": {"config_name": "FIRST"},
    "bot://stats": {"general": {"credits": 123456, "uridium": 7890}},
    "mcp://inventory": {"item_count": 1, "items": [{"name": "laser", "amount": 1}]},
    "mcp://npc_event": {"generic": {"status": "INACTIVE"}},
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        method = payload["method"]
        params = payload.get("params", {})
        result = {}
        if method == "initialize":
            result = {"protocolVersion": "2025-03-26", "capabilities": {"resources": {}, "tools": {}},
                      "serverInfo": {"name": "fake-dmplugin", "version": "test"}}
        elif method == "tools/list":
            result = {"tools": [{"name": "set_profile", "description": "Switch config profile"}]}
        elif method == "resources/read":
            uri = params["uri"]
            if uri not in RESOURCES:
                result = {"contents": []}
            else:
                result = {"contents": [{"uri": uri, "mimeType": "application/json",
                                        "text": json.dumps(RESOURCES[uri])}]}
        response = ({"jsonrpc": "2.0", "id": payload["id"], "result": result}
                    if "id" in payload else None)
        body = json.dumps(response).encode() if response else b""
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Local test-only MCP server")
    parser.add_argument("--port", type=int, default=9878)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print("fake MCP listening on {}".format(args.port), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
