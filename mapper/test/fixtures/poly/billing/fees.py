"""Fee helpers."""
from dataclasses import dataclass

FEE_RATE: float = 0.03
MAX_ITEMS = 50
_internal = 1


# Fee for one amount.
def calculate_fee(amount: int, rate: float = FEE_RATE) -> int:
    return round(amount * rate)


def format_total(total, *items, currency="USD", **extra):
    return f"{currency} {apply_discount(total)}"


def _private_helper(x):
    return x


@dataclass
class Invoice(Base):
    """An invoice."""

    def __init__(self, amount: int, lines: list[str]):
        self.amount = amount

    @property
    def total(self) -> int:
        return calculate_fee(self.amount) + self._tax()

    def _tax(self):
        return 0

    @staticmethod
    def parse(text: str) -> "Invoice":
        return Invoice(int(text), [])
