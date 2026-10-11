import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch


MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "manager.py"
SPEC = importlib.util.spec_from_file_location("local_manager", MODULE_PATH)
manager = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = manager
SPEC.loader.exec_module(manager)


class Response:
    status = 200

    def __init__(self, body: bytes, content_type: str = "application/json"):
        self.headers = {"Content-Type": content_type}
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, size=-1):
        return self.body if size < 0 else self.body[:size]


class ManagerTests(unittest.TestCase):
    def test_openai_compatible_url_validation(self):
        self.assertEqual(manager.safe_ai_url("https://api.example.com/v1/"), "https://api.example.com/v1")
        self.assertEqual(manager.safe_ai_url("http://localhost:8080/v1/chat/completions"),
                         "http://localhost:8080/v1")
        for endpoint in ("http://api.example.com/v1", "https://user:secret@api.example.com/v1",
                         "https://api.example.com/v1?token=secret", "ftp://api.example.com/v1",
                         "https://api.example.com:invalid/v1"):
            with self.subTest(endpoint=endpoint), self.assertRaises(ValueError):
                manager.safe_ai_url(endpoint)

    def test_openai_compatible_request_uses_model_and_bearer_key(self):
        response_body = json.dumps({"choices": [{"message": {"content": json.dumps({
            "action": "use_profile", "profile": "doors", "confidence": 0.8, "summary": "Use doors"
        })}}]}).encode()
        captured = {}

        def fake_urlopen(request, timeout):
            captured["url"] = request.full_url
            captured["headers"] = dict(request.header_items())
            captured["payload"] = json.loads(request.data.decode())
            captured["timeout"] = timeout
            return Response(response_body)

        context = {"profiles": {"profiles": ["farm", "doors"]}}
        with patch.object(manager, "urlopen", side_effect=fake_urlopen):
            result = manager.ask_ai("https://api.example.com/v1", "chat-model", "secret-key", context)
        self.assertEqual(captured["url"], "https://api.example.com/v1/chat/completions")
        self.assertEqual(captured["headers"]["Authorization"], "Bearer secret-key")
        self.assertEqual(captured["payload"]["model"], "chat-model")
        self.assertEqual(captured["payload"]["response_format"], {"type": "json_object"})
        self.assertEqual(result["profile"], "doors")
        self.assertEqual(result["engine"], "openai-compatible")

    def test_api_key_is_persisted_but_not_in_public_state(self):
        original_state = manager.STATE
        try:
            manager.STATE = {"bots": [], "interval_hours": 8, "ai_url": "https://api.example.com/v1",
                             "ai_model": "chat-model", "ai_api_key": "secret-key"}
            public = manager.public_state()
            self.assertTrue(public["ai_api_key_configured"])
            self.assertNotIn("ai_api_key", public)
            self.assertNotIn("secret-key", json.dumps(public))
            with tempfile.TemporaryDirectory() as directory:
                state_path = pathlib.Path(directory) / "state.json"
                with patch.object(manager, "STATE_PATH", state_path):
                    manager.save_state()
                    loaded = manager.load_state()
            self.assertEqual(loaded["ai_api_key"], "secret-key")
            self.assertEqual(loaded["ai_url"], "https://api.example.com/v1")
            self.assertEqual(loaded["ai_model"], "chat-model")
        finally:
            manager.STATE = original_state

    def test_endpoint_only_allows_loopback_and_private_lan(self):
        self.assertEqual(manager.safe_endpoint("http://127.0.0.1:9876/mcp"), "http://127.0.0.1:9876/mcp")
        self.assertEqual(manager.safe_endpoint("http://192.168.1.9:9876/mcp"), "http://192.168.1.9:9876/mcp")
        for endpoint in ("http://8.8.8.8:9876/mcp", "http://0.0.0.0:9876/mcp",
                         "https://127.0.0.1:9876/mcp", "http://user@127.0.0.1:9876/mcp",
                         "http://127.0.0.1:80/mcp", "http://127.0.0.1:9876/other"):
            with self.subTest(endpoint=endpoint), self.assertRaises(ValueError):
                manager.safe_endpoint(endpoint)

    def test_ai_cannot_select_unknown_profile_or_enable_money_actions(self):
        valid = manager.parse_model_recommendation(
            '{"action":"use_profile","profile":"doors","confidence":0.9,"summary":"Use doors"}',
            ["farm", "doors"])
        self.assertEqual(valid["profile"], "doors")
        unknown = manager.parse_model_recommendation(
            '{"action":"use_profile","profile":"invented","confidence":0.9}', ["farm"])
        self.assertEqual(unknown["action"], "keep")
        self.assertIsNone(unknown["profile"])
        blocked = manager.parse_model_recommendation(
            '{"action":"create_profile","profile":"new","confidence":0.9}', ["farm"])
        self.assertEqual(blocked["action"], "keep")
        for body in ('{}', '{"action":"keep","extra_tool":"buy"}'):
            with self.subTest(body=body), self.assertRaises(ValueError):
                manager.parse_model_recommendation(body, ["farm"])

    def test_streamable_http_sse_and_notifications(self):
        responses = [
            Response(b'event: message\ndata: {"jsonrpc":"2.0",\n'
                     b'data: "id":1,"result":{"answer":"ok"}}\n\n', "text/event-stream"),
            Response(b"", "application/json"),
        ]
        client = manager.McpClient("http://127.0.0.1:9876/mcp")
        with patch.object(manager, "urlopen", side_effect=responses):
            self.assertEqual(client.rpc("test"), {"answer": "ok"})
            self.assertIsNone(client.rpc("notifications/initialized", notification=True))

    def test_state_load_handles_invalid_scheduler_values(self):
        with tempfile.TemporaryDirectory() as directory:
            state_path = pathlib.Path(directory) / "state.json"
            state_path.write_text(json.dumps({"interval_hours": "bad", "ai_url": "http://remote.example/api",
                                              "ai_model": "bad model",
                                              "bots": [{"url": "http://127.0.0.1:9876/mcp",
                                                        "next_review_at": float("nan")}] }), encoding="utf-8")
            with patch.object(manager, "STATE_PATH", state_path):
                state = manager.load_state()
        self.assertEqual(state["interval_hours"], 8)
        self.assertEqual(state["ai_url"], "")
        self.assertEqual(state["ai_model"], "")
        self.assertEqual(state["ai_api_key"], "")
        self.assertIsNone(state["bots"][0]["next_review_at"])

    def test_state_file_is_atomically_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            state_path = pathlib.Path(directory) / "state.json"
            with patch.object(manager, "STATE_PATH", state_path), patch.object(manager, "STATE", {"bots": []}):
                manager.save_state()
            self.assertEqual(json.loads(state_path.read_text(encoding="utf-8")), {"bots": []})
            self.assertFalse(state_path.with_suffix(".tmp").exists())


if __name__ == "__main__":
    unittest.main()
