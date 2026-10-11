package platform

import (
	"math"
	"testing"
)

func TestFinanceDecimalExact(t *testing.T) {
	for raw, want := range map[string]int64{"0.01": 1, "1300.50": 130050, "1": 100, "1.2": 120, "10000000000.00": 1000000000000, "-0.01": -1} {
		got, e := parseFinanceDecimal(raw, "INR", true)
		if e != nil || got != want {
			t.Fatalf("%s: %d %v", raw, got, e)
		}
	}
	for _, raw := range []string{"0", "1.001", "1e3", "NaN", "1,000", "10000000000.01", "١", ".5"} {
		if _, e := parseFinanceDecimal(raw, "INR", true); e == nil {
			t.Fatal("accepted", raw)
		}
	}
	if _, e := parseFinanceDecimal("-1", "INR", false); e == nil {
		t.Fatal("unsigned negative")
	}
	if _, e := parseFinanceDecimal("1", "JPY", true); e == nil {
		t.Fatal("unsupported currency")
	}
	for _, pair := range [][2]int64{{math.MaxInt64, 1}, {math.MinInt64, -1}} {
		if _, e := checkedMinorSum(pair[0], pair[1]); e == nil {
			t.Fatal("overflow")
		}
	}
	if got, e := checkedMinorSum(9007199254740991, 2); e != nil || got != 9007199254740993 {
		t.Fatal(got, e)
	}
}
