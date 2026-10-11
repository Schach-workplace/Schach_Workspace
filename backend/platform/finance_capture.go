package platform

import (
	"gorm.io/gorm"
	"net/http"
	"path/filepath"
	"strings"
	"time"
)

func validFinanceContentIdentity(name string, size int64, hash, purpose string) bool {
	return financeClean(name, 240) && filepath.Base(name) == name && !strings.ContainsAny(name, "/\\\x00") && financeSHA256.MatchString(hash) && size >= 1 && size <= 10<<20 && (purpose != "statement" || size <= 8<<20)
}
func (s *Server) bindFinanceIntake(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f, e := readFields(w, r, "retryKey", "expectedVersion", "fileName", "size", "sha256")
	if e != nil {
		return e
	}
	key, e := requiredFinanceKey(f)
	if e != nil {
		return e
	}
	var input struct {
		ExpectedVersion int64
		FileName        string
		Size            int64
		SHA256          string
	}
	if e = applyFields(f, &input); e != nil {
		return e
	}
	if !validFinanceContentIdentity(input.FileName, input.Size, input.SHA256, "receipt") {
		return invalid("Bind a bounded receipt with its exact actual content identity.")
	}
	var out FinanceAssistanceIntake
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		auth := func() error { var e error; out, e = authorizeFinanceIntake(tx, a, r.PathValue("id")); return e }
		_, e := financeBusinessMutation(tx, a, "finance_intake_bind", key, map[string]any{"id": r.PathValue("id"), "fields": f}, auth, func(result BusinessResult) error {
			if len(result.IDs) != 1 || result.IDs[0] != out.ID {
				return financeConflict()
			}
			return nil
		}, func() (BusinessResult, error) {
			if out.Purpose != "receipt" || out.State != "capture_reserved" || out.Version != input.ExpectedVersion {
				return BusinessResult{}, financeConflict()
			}
			out.FileName = input.FileName
			out.Size = input.Size
			out.InternalSHA256 = input.SHA256
			out.State = "reserved"
			out.Version++
			out.ContentGeneration++
			if e := tx.Save(&out).Error; e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "finance_intake", IDs: []string{out.ID}, Versions: []int64{out.Version}}, nil
		})
		return e
	})
	if e != nil {
		return e
	}
	return respond(w, 200, out)
}

// All recovery entries are selected from the original live session and current
// owner/destination scope before the bounded list. Private metadata never enters
// a company-wide finance listing.
func (s *Server) listFinanceIntakes(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	limit, e := pageLimit(r)
	if e != nil {
		return e
	}
	var rows []FinanceAssistanceIntake
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		q := tx.Model(&FinanceAssistanceIntake{}).Where("company_id=? AND owner_id=? AND expires_at>? AND state NOT IN ?", a.Company.ID, a.User.ID, time.Now(), []string{"cancelled", "expired", "purged", "rejected"}).Where("EXISTS (SELECT 1 FROM sessions sess WHERE sess.token_hash=finance_assistance_intakes.session_ref AND sess.user_id=? AND sess.expires_at>?)", a.User.ID, time.Now())
		departments := []string{}
		var ds []Department
		if e := tx.Where("company_id=?", a.Company.ID).Find(&ds).Error; e != nil {
			return e
		}
		for _, d := range ds {
			if a.canCreateExpense(d.ID) {
				departments = append(departments, d.ID)
			}
		}
		if financeAuthority(a.Member.Role) {
			q = q.Where("purpose='statement' OR destination_department_id IN ?", departments)
		} else {
			q = q.Where("purpose='receipt' AND destination_department_id IN ?", departments)
		}
		if cursor := r.URL.Query().Get("cursor"); cursor != "" {
			basis := payloadHash([]string{accessBasis(a), "private_finance_intakes"})
			c, e := decodeReadCursor(cursor, basis)
			if e != nil {
				return e
			}
			q = q.Where("created_at<? OR(created_at=? AND id<?)", c.Created, c.Created, c.ID)
		}
		return q.Order("created_at DESC,id DESC").Limit(limit + 1).Find(&rows).Error
	})
	if e != nil {
		return e
	}
	more := len(rows) > limit
	if more {
		rows = rows[:limit]
	}
	cursor := ""
	if more {
		last := rows[len(rows)-1]
		cursor = encodeReadCursor(readCursor{payloadHash([]string{accessBasis(a), "private_finance_intakes"}), last.CreatedAt.Format(time.RFC3339Nano), last.ID})
	}
	for index := range rows {
		rows[index].CreatedAt = rows[index].CreatedAt.UTC()
		rows[index].ExpiresAt = rows[index].ExpiresAt.UTC()
	}
	return respond(w, 200, map[string]any{"items": rows, "nextCursor": cursor, "hasMore": more})
}
