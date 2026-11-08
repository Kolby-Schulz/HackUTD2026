use std::fmt;

pub const FEE_RATE: f64 = 0.03;
const SECRET: u32 = 7;

/// An invoice.
#[derive(Debug)]
pub struct Invoice {
    pub amount: u64,
}

pub enum Status { Open, Paid }

pub trait Payer {
    fn pay(&self, amount: u64) -> bool;
}

impl Invoice {
    pub fn new(amount: u64) -> Self {
        Invoice { amount }
    }

    pub fn total(&self) -> u64 {
        calculate_fee(self.amount) + self.tax()
    }

    fn tax(&self) -> u64 { 0 }
}

impl Payer for Invoice {
    fn pay(&self, amount: u64) -> bool { true }
}

/// Fee for one amount.
pub fn calculate_fee(amount: u64) -> u64 {
    helper(amount)
}

fn helper(x: u64) -> u64 { x }

#[cfg(test)]
mod tests {
    #[test]
    fn it_works() {}
}
