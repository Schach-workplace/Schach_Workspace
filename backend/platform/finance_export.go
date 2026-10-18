package platform

import (
	"encoding/json"
	"gorm.io/gorm"
	"io"
	"net/http"
	"strconv"
	"strings"
)

type expenseExportRow struct {
	ID          string `json:"id"`
	Version     int64  `json:"version"`
	Code        string `json:"code"`
	Title       string `json:"title"`
	ExpenseDate string `json:"expenseDate"`
	Currency    string `json:"currency"`
	AmountMinor string `json:"amountMinor"`
	Status      string `json:"status"`
}

// Export is a bounded current-authority read, with no financial decisions or events.
func (s *Server) expenseExport(w http.ResponseWriter, r *http.Request) error {
	a, err := s.access(r)
	if err != nil {
		return err
	}
	var input struct {
		Expenses []struct {
			ID              string `json:"id"`
			ExpectedVersion int64  `json:"expectedVersion"`
		} `json:"expenses"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil {
		return invalid("Select expense IDs and their expected versions only.")
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return invalid("Provide one export request.")
	}
	if len(input.Expenses) < 1 || len(input.Expenses) > 100 {
		return invalid("Select between 1 and 100 expenses.")
	}
	seen := map[string]bool{}
	for _, e := range input.Expenses {
		if strings.TrimSpace(e.ID) == "" || e.ExpectedVersion < 1 || seen[e.ID] {
			return invalid("Select distinct expense IDs with positive expected versions.")
		}
		seen[e.ID] = true
	}
	rows := make([]expenseExportRow, 0, len(input.Expenses))
	err = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		if a.financeScope() == "none" {
			return denied()
		}
		for _, source := range input.Expenses {
			expense, e := scopedExpense(tx, a, source.ID)
			if e != nil {
				return e
			}
			if expense.Version != source.ExpectedVersion {
				return financeConflict()
			}
			rows = append(rows, expenseExportRow{expense.ID, expense.Version, expense.Code, expense.Title, expense.ExpenseDate, expense.Currency, strconv.FormatInt(expense.AmountMinor, 10), expense.Status})
		}
		return nil
	})
	if err != nil {
		return err
	}
	return respond(w, http.StatusOK, map[string]any{"rows": rows})
}
