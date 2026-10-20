"""AC25: contracts/openapi/focusflow-api.yaml matches the routers."""

from pathlib import Path

import yaml

from app.main import app

_RELATIVE = Path("contracts/openapi/focusflow-api.yaml")
# Repo checkout, or the read-only mount docker-compose gives the api service.
_CANDIDATES = [p / _RELATIVE for p in (*Path(__file__).resolve().parents, Path("/"))]


def _load() -> dict:
    for candidate in _CANDIDATES:
        if candidate.is_file():
            return yaml.safe_load(candidate.read_text())
    raise AssertionError(f"OpenAPI contract not found in {_CANDIDATES}")


def _responses(spec: dict, path: str, method: str) -> set[str]:
    return set(spec["paths"][path][method]["responses"])


def test_sessions_path_is_absent() -> None:
    spec = _load()
    assert not [p for p in spec["paths"] if "sessions" in p]


def test_task_fields_documented() -> None:
    props = _load()["components"]["schemas"]["Task"]["properties"]
    assert {"priority", "estimated_pomodoros", "completed_pomodoros"} <= set(props)


def test_timer_routes_and_body_documented() -> None:
    spec = _load()
    assert {"201", "404", "409"} <= _responses(spec, "/timer/start", "post")
    assert {"200"} <= _responses(spec, "/timer", "get")
    assert {"204", "404"} <= _responses(spec, "/timer/stop", "post")
    for route, method in (("/timer/start", "post"), ("/timer", "get"), ("/timer/stop", "post")):
        assert "401" in _responses(spec, route, method)
    timer = spec["components"]["schemas"]["Timer"]
    fields = {
        "task_id", "phase", "started_at", "ends_at", "duration_seconds",
        "remaining_seconds", "server_time", "cycle_position",
    }  # fmt: skip
    assert fields <= set(timer["properties"])
    assert fields <= set(timer["required"])
    null_branch = spec["paths"]["/timer"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"]["oneOf"]
    assert {"type": "null"} in null_branch


def test_every_router_operation_is_documented() -> None:
    spec = _load()
    for path, item in app.openapi()["paths"].items():
        for method, operation in item.items():
            documented = _responses(spec, path, method)
            for status in operation["responses"]:
                if status != "422":  # FastAPI-generated; the contract documents it by $ref
                    assert status in documented, (path, method, status)
    assert "/tasks/{task_id}/sessions" not in app.openapi()["paths"]
