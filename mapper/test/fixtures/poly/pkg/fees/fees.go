package fees

import "fmt"

const FeeRate = 0.03
const (
	MaxItems int = 50
	minItems     = 1
)

// Invoice is one bill.
type Invoice struct {
	Amount int
}

type Payer interface {
	Pay(amount int) error
}

type Status int

// CalculateFee returns the fee.
func CalculateFee(amount int, rate float64) int {
	return int(float64(amount) * rate)
}

func helper(a, b int) (int, error) {
	return a + b, nil
}

func (inv *Invoice) Total() int {
	fmt.Println("x")
	return CalculateFee(inv.Amount, FeeRate) + inv.tax()
}

func (inv Invoice) tax() int { return 0 }

func Sum(values ...int) (total int) {
	v, _ := helper(1, 2)
	return v
}
