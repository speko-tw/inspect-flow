from unittest.mock import Mock
from uuid import uuid4

import pytest

from app.services.project_templates import apply_template


def test_apply_template_requires_a_source():
    with pytest.raises(ValueError, match="template_id or system_id"):
        apply_template(Mock(), project_id=uuid4())
