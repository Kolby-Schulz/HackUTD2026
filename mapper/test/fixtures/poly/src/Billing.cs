using System;

namespace App.Billing
{
    /// <summary>An invoice.</summary>
    public class Invoice : Base
    {
        public Invoice(int amount) { }

        public int Total()
        {
            return Fees.CalculateFee(10) + Tax();
        }

        private int Tax() { return 0; }
    }

    public static class Fees
    {
        public static int CalculateFee(int amount, double rate = 0.03)
        {
            return (int)(amount * rate);
        }
    }

    public interface IPayer { void Pay(int amount); }
}
