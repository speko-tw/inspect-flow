"""Transport-level caps for request bodies (SEC-004, #462).

These caps only stop absurdly large payloads before they reach the
database. Where a domain limit already exists (plan and zone names 128
characters, task location 256) the cap sits above it so the domain check
still answers near-misses with its own error code. Caps for fields the
models leave unbounded are spec design decisions recorded in the
inspection-planning and template-system specs.
"""

# Names and titles: plan/zone names (domain limit 128) get 4x headroom.
PLANNING_NAME_MAX = 512
LOCATION_TEXT_MAX = 1024
# Template names, item and point titles, measurement field names.
TITLE_MAX = 256
# Instructions, cancellation reasons, text standards.
LONG_TEXT_MAX = 2000
UNIT_MAX = 32
# Decimal text such as value, tolerance and bounds.
NUMBER_TEXT_MAX = 64
MIN_PHOTO_COUNT_MAX = 1000

# List fields.
ITEM_IDS_MAX = 200
TEMPLATES_MAX = 200
POINTS_MAX = 200
MEASUREMENT_FIELDS_MAX = 50
EVIDENCE_REQUIREMENTS_MAX = 20
