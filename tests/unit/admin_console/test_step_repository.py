import json

from apps.admin_console.database.repositories.step_repository import StepRepository


def test_legacy_pause_log_is_normalized_to_failed_llm_trace():
    repository = StepRepository()
    trace = {
        "trace_id": "pause-log",
        "type": "log",
        "name": "artemis.services.llm",
        "status": "success",
        "payload": json.dumps(
            {
                "message": (
                    "LLM Error: 503 UNAVAILABLE. {'error': {'message': 'High demand'}}. "
                    "Pausing execution to wait for resume signal..."
                )
            }
        ),
    }

    normalized = repository._normalize_display_trace(trace)

    assert normalized["type"] == "llm_call"
    assert normalized["name"] == "llm_pause"
    assert normalized["status"] == "failed"
    assert normalized["payload"]["pause"] is True
    assert normalized["payload"]["error"].startswith("503 UNAVAILABLE")


def test_unrelated_log_is_not_presented_as_llm_failure():
    repository = StepRepository()
    trace = {
        "trace_id": "ordinary-log",
        "type": "log",
        "name": "artemis.services.llm",
        "status": "success",
        "payload": json.dumps({"message": "LLM request completed"}),
    }

    normalized = repository._normalize_display_trace(trace)

    assert normalized["type"] == "log"
    assert normalized["status"] == "success"


def test_retrying_llm_payload_keeps_user_visible_retry_details():
    repository = StepRepository()
    trace = {
        "trace_id": "retry-1",
        "type": "llm_call",
        "name": "llm_retry",
        "status": "retrying",
        "payload": json.dumps(
            {
                "error": "503 UNAVAILABLE: high demand",
                "delay": 1.18,
                "provider": "google",
                "source": "provider_sdk",
                "recoverable": True,
                "internal_noise": "do not expose",
            }
        ),
    }

    normalized = repository._normalize_display_trace(trace)

    assert normalized["payload"] == {
        "error": "503 UNAVAILABLE: high demand",
        "delay": 1.18,
        "provider": "google",
        "source": "provider_sdk",
        "recoverable": True,
    }


def test_terminal_llm_payload_keeps_wait_and_retry_aggregation():
    repository = StepRepository()
    retries = [
        {
            "delay": 5.0,
            "scheduled_at": 100.0,
            "provider": "google",
            "source": "provider_sdk",
        }
    ]
    trace = {
        "type": "llm_call",
        "name": "llm_pause",
        "status": "failed",
        "payload": json.dumps(
            {
                "error": "503 UNAVAILABLE",
                "pause": True,
                "request_id": "request-1",
                "provider": "google",
                "waited_seconds": 18.5,
                "retries": retries,
                "messages": ["private prompt"],
            }
        ),
    }

    normalized = repository._normalize_display_trace(trace)

    assert normalized["payload"] == {
        "error": "503 UNAVAILABLE",
        "provider": "google",
        "pause": True,
        "request_id": "request-1",
        "waited_seconds": 18.5,
        "retries": retries,
    }


def test_has_steps_probes_the_real_schema(tmp_path):
    """The circuit breaker's zero-step discriminator runs against live SQLite:
    a wrong table/column name would silently disable the whole queue hold."""
    from apps.admin_console.database.connection import db_session
    from artemis.data_engine.storage import StorageManager

    db_path = tmp_path / "engine.db"
    StorageManager(db_path, tmp_path)  # bootstraps the sessions/steps schema

    repository = StepRepository(db_path)
    with db_session(db_path) as conn:
        conn.execute(
            "INSERT INTO sessions (session_id, initial_goal, start_time) VALUES (?, ?, ?)",
            ("sess-1", "goal", 1.0),
        )
        conn.execute(
            "INSERT INTO sessions (session_id, initial_goal, start_time) VALUES (?, ?, ?)",
            ("sess-2", "goal", 2.0),
        )
        conn.execute(
            "INSERT INTO steps (step_id, session_id, step_number, timestamp) VALUES (?, ?, ?, ?)",
            ("step-1", "sess-1", 1, 1.0),
        )
        conn.commit()

    assert repository.has_steps("sess-1") is True
    assert repository.has_steps("sess-2") is False  # started but never executed a step
    assert repository.has_steps("missing") is False
