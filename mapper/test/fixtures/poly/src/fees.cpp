#include "fees.h"

namespace billing {

// Fee for one amount.
int calculate_fee(int amount, double rate) {
    return helper(amount) * rate;
}

static int helper(int x) { return x; }

int Invoice::total() const {
    return calculate_fee(amount_, 0.03);
}

}  // namespace billing
