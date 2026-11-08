FEE_RATE = 0.03

# Fee for one amount.
def calculate_fee(amount, rate = FEE_RATE)
  (amount * rate).round
end

module Billing
  class Invoice < Base
    def initialize(amount)
      @amount = amount
    end

    def total
      calculate_fee(@amount) + tax
    end

    def self.parse(text, strict: false)
      Invoice.new(text.to_i)
    end
  end
end
