"""Stable occurrence IDs survive cached-feed ordering changes."""

import hashlib
import json


def event_identity(feed_id, event):
    identity = [event.get("uid") or event.get("title", ""), event.get("start", "")]
    return (
        feed_id
        + ":"
        + hashlib.sha256(json.dumps(identity, ensure_ascii=False).encode()).hexdigest()[
            :32
        ]
    )
