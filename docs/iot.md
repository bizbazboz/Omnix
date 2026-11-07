# Govee lights and calendar triggers

Open **Settings → Integrations → Govee**. Request a Developer API key in Govee
Home, save it in Omnix, then select **Discover devices**. The key is encrypted in
the database, belongs to your account and is never returned to the browser.
Replacing a key pauses existing rules; disconnecting removes rules and history.

Open **IoT → Lights** to apply a supported power, brightness, colour, colour
temperature, scene, DIY scene or snapshot command. Controls are discovered from
Govee, not inferred from the product name. Use **Refresh scenes** for dynamic
options and **Refresh state** to query the device. A command acknowledgement is
not proof of physical execution. Cloud API access requires an internet connection.

Curtain Lights models are supported when Govee exposes them through its OpenAPI.
Drawing pixels, uploading custom images and Govee-app-only effects are not exposed
by this integration. Create supported DIY scenes in Govee Home first.

## iCal rules

Connect an iCal subscription in Calendar Integrations, then create a rule in the
Govee integration. Select the light, calendar, optional title substring, start or
end, offset and action. Negative offsets run before the event; positive offsets
run after it. All-day events are excluded unless explicitly enabled. Their times
come from the calendar's timezone boundaries. Recurring occurrences have stable,
separate identities; cancelled occurrences disappear on the next calendar sync.

Keep the Docker worker and scheduler running. They check every 30 seconds; these
are calendar reminders, not second-accurate timers. Newly created or edited rules
do not replay past triggers. Actions older than two minutes and calendars whose
last successful refresh is older than 24 hours are skipped. Deleted subscriptions
and disabled rules cannot control devices.

Execution claims are stored in PostgreSQL before contacting Govee. Unconfirmed
network outcomes are not retried automatically. Explicit throttling can be
deferred to a subsequent check within the two-minute window. Review receipts in
**IoT → Calendar activity**. Delete a rule to remove its associated receipts.

Protocol: [Govee device capabilities](https://developer.govee.com/reference/get-you-devices),
[control](https://developer.govee.com/reference/control-you-devices), and
[dynamic scenes](https://developer.govee.com/reference/get-light-scene).
