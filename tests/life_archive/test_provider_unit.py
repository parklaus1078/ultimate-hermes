import json
import unittest

from hermes_plugins.life_archive import LifeArchiveMemoryProvider
from hermes_plugins.life_archive.embeddings import LocalHashEmbeddingProvider, event_embedding_text, stable_hash
from hermes_plugins.life_archive.extractors import extract_session_events, infer_event_type, infer_sensitivity


class LifeArchiveProviderUnitTest(unittest.TestCase):
    def test_tool_schemas_are_exposed(self):
        provider = LifeArchiveMemoryProvider({})
        names = {schema["name"] for schema in provider.get_tool_schemas()}
        self.assertIn("life_capture", names)
        self.assertIn("life_recall", names)
        self.assertIn("life_timeline", names)
        self.assertIn("life_link_source", names)
        self.assertIn("life_project_status", names)

    def test_uninitialized_tool_call_is_structured_error(self):
        provider = LifeArchiveMemoryProvider({})
        payload = json.loads(provider.handle_tool_call("life_recall", {"query": "x"}))
        self.assertFalse(payload["success"])
        self.assertIn("not initialized", payload["error"])

    def test_extractor_detects_durable_events(self):
        messages = [
            {"role": "user", "content": "We decided to use Hermes native provider for project memory."},
            {"role": "assistant", "content": "Noted."},
        ]
        events = extract_session_events(messages)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["type"], "decision")

    def test_inference_helpers(self):
        self.assertEqual(infer_event_type("This legal dispute may matter"), "legal")
        self.assertEqual(infer_sensitivity("This legal dispute may matter"), "legal_sensitive")

    def test_local_embedding_provider_is_deterministic(self):
        provider = LocalHashEmbeddingProvider(dimensions=16)
        first = provider.embed_one("Hermes long term memory")
        second = provider.embed_one("Hermes long term memory")
        self.assertEqual(first, second)
        self.assertEqual(len(first), 16)

    def test_event_embedding_text_is_hashable(self):
        text = event_embedding_text(
            {
                "title": "Semantic Recall",
                "type": "decision",
                "summary": "Use pgvector.",
                "body": "<html><body>Strip tags before embedding.</body></html>",
            },
            max_chars=200,
        )
        self.assertIn("Semantic Recall", text)
        self.assertIn("Strip tags", text)
        self.assertEqual(stable_hash(text), stable_hash(text))


if __name__ == "__main__":
    unittest.main()
