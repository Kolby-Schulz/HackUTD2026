<?php
namespace App\Billing;

const FEE_RATE = 0.03;

/** Fee for one amount. */
function calculate_fee(int $amount, float $rate = FEE_RATE): int
{
    return (int) round($amount * $rate);
}

class Invoice extends Base implements Payable
{
    public function __construct(private int $amount) {}

    public function total(): int
    {
        return calculate_fee($this->amount) + $this->tax();
    }

    private function tax(): int { return 0; }

    public static function parse(string $text): Invoice
    {
        return new Invoice((int) $text);
    }
}
