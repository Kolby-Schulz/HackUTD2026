package billing;

import java.util.List;

/** Billing service. */
public class Billing {
    public Billing(int rate) {}

    /** Fee for one amount. */
    public int calculateFee(int amount, double rate) {
        return round(amount * rate);
    }

    @Override
    public String format(List<String> lines, String... rest) {
        return helper(lines) + new Invoice().toString();
    }

    private int round(double x) { return (int) x; }

    String helper(List<String> lines) { return ""; }
}

interface Payer {
    void pay(int amount);
}
