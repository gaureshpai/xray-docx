"""Transport models and explicit resource limits."""

from dataclasses import dataclass


class DocxError(ValueError):
    """A document that cannot be safely inspected."""


@dataclass(frozen=True)
class Limits:
    input_bytes: int = 3_000_000
    expanded_bytes: int = 12_000_000
    entries: int = 512
    xml_bytes: int = 3_000_000
    response_bytes: int = 4_000_000


WEB_LIMITS = Limits()
CLI_LIMITS = Limits(input_bytes=20_000_000, expanded_bytes=50_000_000, xml_bytes=20_000_000, response_bytes=100_000_000)
