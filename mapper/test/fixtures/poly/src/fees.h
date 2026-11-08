#pragma once

struct Point { int x; int y; };

class Invoice {
public:
    int total() const;
    int tax() { return 0; }
private:
    int amount_;
};

int calculate_fee(int amount, double rate);
const char *label(const char *name, int *out);
