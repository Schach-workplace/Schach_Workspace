package platform

import (
	"math"
	"regexp"
	"strconv"
	"strings"
)

var financeDecimal = regexp.MustCompile(`^[0-9]+(?:\.[0-9]{1,2})?$`)

func parseFinanceDecimal(value, currency string, allowSigned bool) (int64, error) {
	if !in(currency, "INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD") {
		return 0, invalid("Choose a supported company currency.")
	}
	value = strings.TrimSpace(value)
	negative := false
	if allowSigned && len(value) > 0 && (value[0] == '-' || value[0] == '+') {
		negative = value[0] == '-'
		value = value[1:]
	}
	if !financeDecimal.MatchString(value) {
		return 0, invalid("Enter an exact amount with up to two decimal places and no grouping.")
	}
	parts := strings.SplitN(value, ".", 2)
	major, e := strconv.ParseInt(parts[0], 10, 64)
	if e != nil || major > maxMoneyMinor/100 {
		return 0, invalid("Amount exceeds the supported limit.")
	}
	fraction := int64(0)
	if len(parts) == 2 {
		f := parts[1]
		if len(f) == 1 {
			f += "0"
		}
		fraction, _ = strconv.ParseInt(f, 10, 64)
	}
	minor := major*100 + fraction
	if minor < 1 || minor > maxMoneyMinor {
		return 0, invalid("Amount must be nonzero and within the supported limit.")
	}
	if negative {
		minor = -minor
	}
	return minor, nil
}
func checkedMinorSum(total, next int64) (int64, error) {
	if next > 0 && total > math.MaxInt64-next || next < 0 && total < math.MinInt64-next {
		return 0, invalid("This total exceeds the supported range.")
	}
	return total + next, nil
}
