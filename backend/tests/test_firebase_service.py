"""
Unit tests for backend.services.firebase_service

Firestore is fully mocked - no live database connection is required.
Tests focus on:
  - Data contracts (what gets written to Firestore)
  - Correctness of Python-side sorting/filtering
  - Edge cases (missing fields, role validation)
"""

import pytest
from unittest.mock import MagicMock, patch, call

from backend.services import firebase_service


# ---------------------------------------------------------------------------
# Fixtures - mock Firestore client
# ---------------------------------------------------------------------------

def _make_doc(doc_id: str, data: dict) -> MagicMock:
    """Build a fake Firestore DocumentSnapshot."""
    doc = MagicMock()
    doc.id = doc_id
    doc.exists = True
    doc.to_dict.return_value = data
    return doc


@pytest.fixture(autouse=True)
def mock_db(monkeypatch):
    """
    Replace firebase_service._db with a MagicMock so no real Firestore
    calls are made. Returns the mock so individual tests can configure it.
    """
    db = MagicMock()
    monkeypatch.setattr(firebase_service, "_db", db)
    return db


# ---------------------------------------------------------------------------
# _utcnow
# ---------------------------------------------------------------------------

def test_utcnow_is_iso8601():
    from datetime import datetime
    ts = firebase_service._utcnow()
    # Must parse as ISO 8601 without raising.
    dt = datetime.fromisoformat(ts)
    assert dt.tzinfo is not None, "Timestamp must be timezone-aware"


# ---------------------------------------------------------------------------
# save_message
# ---------------------------------------------------------------------------

class TestSaveMessage:
    def test_valid_user_role(self, mock_db):
        ref = MagicMock()
        ref.id = "msg1"
        (mock_db.collection.return_value
             .document.return_value
             .collection.return_value
             .document.return_value
             .collection.return_value
             .document.return_value) = ref

        result = firebase_service.save_message("proj1", "chat1", "user", "Hello")
        assert result["role"] == "user"
        assert result["content"] == "Hello"
        assert result["id"] == "msg1"

    def test_valid_assistant_role(self, mock_db):
        ref = MagicMock()
        ref.id = "msg2"
        (mock_db.collection.return_value
             .document.return_value
             .collection.return_value
             .document.return_value
             .collection.return_value
             .document.return_value) = ref

        result = firebase_service.save_message("proj1", "chat1", "assistant", "Hi there")
        assert result["role"] == "assistant"

    def test_invalid_role_raises(self, mock_db):
        with pytest.raises(ValueError, match="Invalid message role"):
            firebase_service.save_message("proj1", "chat1", "system", "Injected prompt")

    def test_arbitrary_role_raises(self, mock_db):
        with pytest.raises(ValueError):
            firebase_service.save_message("proj1", "chat1", "hacker", "Boom")


# ---------------------------------------------------------------------------
# list_projects - Python-side sorting
# ---------------------------------------------------------------------------

class TestListProjects:
    def test_sorted_by_updated_at_descending(self, mock_db):
        docs = [
            _make_doc("p1", {"members": {"uid1": "admin"}, "updatedAt": "2024-01-01T10:00:00+00:00", "name": "Old"}),
            _make_doc("p2", {"members": {"uid1": "editor"}, "updatedAt": "2024-06-01T10:00:00+00:00", "name": "New"}),
            _make_doc("p3", {"members": {"uid1": "viewer"}, "updatedAt": "2024-03-01T10:00:00+00:00", "name": "Mid"}),
        ]
        (mock_db.collection.return_value
             .where.return_value
             .limit.return_value
             .stream.return_value) = docs

        result = firebase_service.list_projects("uid1")
        names = [r["name"] for r in result]
        assert names == ["New", "Mid", "Old"], "Projects should be sorted newest-first"

    def test_missing_updated_at_sorted_last(self, mock_db):
        docs = [
            _make_doc("p1", {"members": {"uid1": "admin"}, "updatedAt": "2024-01-01T00:00:00+00:00", "name": "Dated"}),
            _make_doc("p2", {"members": {"uid1": "admin"}, "name": "Undated"}),  # no updatedAt
        ]
        (mock_db.collection.return_value
             .where.return_value
             .limit.return_value
             .stream.return_value) = docs

        result = firebase_service.list_projects("uid1")
        # "Undated" sorts as "" which is less than any date string - ends up last.
        assert result[-1]["name"] == "Undated"


# ---------------------------------------------------------------------------
# list_messages - sorting
# ---------------------------------------------------------------------------

class TestListMessages:
    def test_sorted_chronologically(self, mock_db):
        docs = [
            _make_doc("m3", {"role": "assistant", "content": "C", "createdAt": "2024-01-01T10:02:00+00:00"}),
            _make_doc("m1", {"role": "user",      "content": "A", "createdAt": "2024-01-01T10:00:00+00:00"}),
            _make_doc("m2", {"role": "user",      "content": "B", "createdAt": "2024-01-01T10:01:00+00:00"}),
        ]
        (mock_db.collection.return_value
             .document.return_value
             .collection.return_value
             .document.return_value
             .collection.return_value
             .limit.return_value
             .stream.return_value) = docs

        result = firebase_service.list_messages("proj1", "chat1")
        contents = [r["content"] for r in result]
        assert contents == ["A", "B", "C"], "Messages must be in chronological order"


# ---------------------------------------------------------------------------
# upsert_user - idempotency
# ---------------------------------------------------------------------------

class TestUpsertUser:
    def test_does_not_overwrite_existing_user(self, mock_db):
        existing_doc = MagicMock()
        existing_doc.exists = True
        (mock_db.collection.return_value
             .document.return_value
             .get.return_value) = existing_doc

        firebase_service.upsert_user("uid1", "user@example.com", "Alice")

        # .set() should NOT have been called - user already exists.
        mock_db.collection.return_value.document.return_value.set.assert_not_called()

    def test_creates_new_user_if_not_exists(self, mock_db):
        non_existing_doc = MagicMock()
        non_existing_doc.exists = False
        (mock_db.collection.return_value
             .document.return_value
             .get.return_value) = non_existing_doc

        firebase_service.upsert_user("uid2", "new@example.com", "Bob")

        mock_db.collection.return_value.document.return_value.set.assert_called_once()
        call_data = mock_db.collection.return_value.document.return_value.set.call_args[0][0]
        assert call_data["uid"] == "uid2"
        assert call_data["tier"] == "free"
