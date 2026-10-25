import json, uuid
from app.core import Session, SendAttempt
from app.tasks import send
import app.tasks as tasks


def record(user, accounts):
    with Session() as db:
        value = SendAttempt(
            owner=user.id,
            mailbox=accounts[0].id,
            key=str(uuid.uuid4()),
            payload_hash="test",
            payload=json.dumps(
                {
                    "to": ["recipient@example.com"],
                    "cc": [],
                    "bcc": [],
                    "subject": "Contract",
                    "body": "Text",
                }
            ),
        )
        db.add(value)
        db.commit()
        return value.id


def test_ambiguous_send_never_retries(monkeypatch, user, accounts):
    calls = []

    def unknown(*args):
        calls.append(1)
        raise TimeoutError("after DATA")

    monkeypatch.setattr(tasks, "send_message", unknown)
    aid = record(user, accounts)
    send.run(aid)
    send.run(aid)
    with Session() as db:
        assert db.get(SendAttempt, aid).status == "outcome_unknown"
    assert len(calls) == 1


def test_duplicate_worker_dispatch(monkeypatch, user, accounts):
    calls = []

    def accepted(*args):
        calls.append(1)
        return {"accepted": True, "receipt": "contract"}

    monkeypatch.setattr(tasks, "send_message", accepted)
    aid = record(user, accounts)
    send.run(aid)
    send.run(aid)
    with Session() as db:
        assert db.get(SendAttempt, aid).status == "accepted"
    assert len(calls) == 1


def test_interrupted_worker_not_resubmitted(monkeypatch, user, accounts):
    def forbidden(*args):
        raise AssertionError("must not submit")

    monkeypatch.setattr(tasks, "send_message", forbidden)
    aid = record(user, accounts)
    with Session() as db:
        value = db.get(SendAttempt, aid)
        value.status = "sending"
        db.commit()
    send.run(aid)
    with Session() as db:
        assert db.get(SendAttempt, aid).status == "sending"
