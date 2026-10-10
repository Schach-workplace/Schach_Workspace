package platform

import (
	"encoding/json"
	"fmt"
	"gorm.io/gorm"
	"io"
	"net/http"
)

type CommunicationExpenseLink struct {
	CompanyID       string `gorm:"primaryKey;size:80"`
	ConversationID  string
	AnchorMessageID string `gorm:"primaryKey;size:80"`
	ExpenseID       string
	CreatedBy       string
	SourceRevision  int64
}
type CommunicationExpenseRetry struct {
	CompanyID   string `gorm:"primaryKey;size:80"`
	ActorID     string `gorm:"primaryKey;size:80"`
	RetryKey    string `gorm:"primaryKey;size:100"`
	RequestHash string
	ExpenseID   string
}
type expenseConversionInput struct {
	ConversionInput
	Expense map[string]json.RawMessage `json:"expense"`
}

func makeCommunicationExpense(tx *gorm.DB, a *access, input expenseConversionInput) (Expense, error) {
	e := Expense{ID: newID("exp"), CompanyID: a.Company.ID, CreatedBy: a.User.ID, Status: "draft", CreatedAt: nowString(), UpdatedAt: nowString(), Version: 1, Currency: a.Company.Currency, Receipts: []ExpenseReceipt{}}
	for key := range input.Expense {
		if !in(key, expenseFields...) {
			return e, invalid("Unknown expense field: " + key)
		}
	}
	if err := applyFields(input.Expense, &e); err != nil {
		return e, err
	}
	if input.Publication.Excerpt != "" {
		e.Description += "\n\nPublished conversation excerpt:\n" + input.Publication.Excerpt
	}
	if err := validateExpense(tx, a, &e); err != nil {
		return e, err
	}
	if !a.canCreateExpense(e.DepartmentID) {
		return e, denied()
	}
	return e, nil
}
func (s *Server) previewExpenseConversion(w http.ResponseWriter, r *http.Request) error {
	var input expenseConversionInput
	if e := decode(w, r, &input); e != nil {
		return e
	}
	audience := []string{}
	e := s.conversionTransaction(r, func(tx *gorm.DB, a *access, scope *conversationScope) error {
		if e := verifyConversionSources(tx, scope, input.ConversionInput, true); e != nil {
			return e
		}
		expense, e := makeCommunicationExpense(tx, a, input)
		if e != nil {
			return e
		}
		for uid, member := range a.Members {
			other := *a
			other.Member = member
			other.User = a.Users[uid]
			if member.Active && other.canReadExpense(expense) {
				audience = append(audience, uid)
			}
		}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"audienceUserIds": audience, "notice": "Selected fields, excerpt and evidence become an independent incurred-expense draft in the finance audience. Review the amount, date, vendor and category. Submission, receipt policy, budget checks, independent approval and payment remain separate finance actions; future roles can change this audience."})
}
func (s *Server) convertMessageToExpense(w http.ResponseWriter, r *http.Request) error {
	var input expenseConversionInput
	if e := decode(w, r, &input); e != nil {
		return e
	}
	id := ""
	e := s.conversionTransaction(r, func(tx *gorm.DB, a *access, scope *conversationScope) error {
		if e := verifyConversionSources(tx, scope, input.ConversionInput, false); e != nil {
			return e
		}
		var retry CommunicationExpenseRetry
		err := tx.First(&retry, "company_id=? AND actor_id=? AND retry_key=?", a.Company.ID, a.User.ID, input.RetryKey).Error
		if err == nil {
			if retry.RequestHash != payloadHash(input) {
				return conflict()
			}
			if _, e := scopedExpense(tx, a, retry.ExpenseID); e != nil {
				return e
			}
			id = retry.ExpenseID
			return nil
		}
		if err != gorm.ErrRecordNotFound {
			return err
		}
		if e := verifyConversionSources(tx, scope, input.ConversionInput, true); e != nil {
			return e
		}
		var link CommunicationExpenseLink
		err = tx.First(&link, "company_id=? AND anchor_message_id=?", a.Company.ID, input.AnchorMessageID).Error
		if err == nil {
			if _, e := scopedExpense(tx, a, link.ExpenseID); e != nil {
				return e
			}
			id = link.ExpenseID
		} else if err == gorm.ErrRecordNotFound {
			expense, e := makeCommunicationExpense(tx, a, input)
			if e != nil {
				return e
			}
			expense.Code, e = nextExpenseCode(tx, a.Company.ID)
			if e != nil {
				return e
			}
			if e := tx.Omit("Receipts").Create(&expense).Error; e != nil {
				return e
			}
			id = expense.ID
			for _, mid := range input.Publication.AttachmentIDs {
				if s.opts.MediaStore == nil {
					return missing()
				}
				var media CommunicationMedia
				if e := tx.First(&media, "id=? AND company_id=? AND conversation_id=?", mid, a.Company.ID, scope.Conversation.ID).Error; e != nil {
					return e
				}
				reader, e := s.opts.MediaStore.Open(r.Context(), mid)
				if e != nil {
					return e
				}
				data, e := io.ReadAll(io.LimitReader(reader, maxUpload+1))
				_ = reader.Close()
				if e != nil {
					return e
				}
				if len(data) > maxUpload {
					return invalid("Receipt retains the 10-MiB limit.")
				}
				kind, e := uploadType(media.FileName, data)
				if e != nil {
					return e
				}
				if e := tx.Create(&ExpenseReceipt{ID: newID("rcp"), CompanyID: a.Company.ID, ExpenseID: id, FileName: media.FileName, MimeType: kind, Size: int64(len(data)), UploadedBy: a.User.ID, CreatedAt: nowString(), Data: data}).Error; e != nil {
					return e
				}
				expense.Version++
			}
			if expense.Version > 1 {
				if e := tx.Model(&expense).Update("version", expense.Version).Error; e != nil {
					return e
				}
			}
			source, e := scopedMessage(tx, scope, input.AnchorMessageID)
			if e != nil {
				return e
			}
			if e := tx.Create(&CommunicationExpenseLink{CompanyID: a.Company.ID, ConversationID: scope.Conversation.ID, AnchorMessageID: source.ID, SourceRevision: source.Revision, ExpenseID: id, CreatedBy: a.User.ID}).Error; e != nil {
				return e
			}
			if e := financeEvent(tx, a.Company.ID, expense.DepartmentID, "expense", id, a.User.ID, "expense_created", fmt.Sprintf("%s · %s · %s; explicitly published draft, separate financial review required.", expense.Code, expense.Title, moneyLabel(expense.Currency, expense.AmountMinor))); e != nil {
				return e
			}
			if e := appendCommunicationEvent(tx, scope, "expense_linked", source.ID, source.Sequence); e != nil {
				return e
			}
		} else {
			return err
		}
		return tx.Create(&CommunicationExpenseRetry{CompanyID: a.Company.ID, ActorID: a.User.ID, RetryKey: input.RetryKey, RequestHash: payloadHash(input), ExpenseID: id}).Error
	})
	if e != nil {
		return e
	}
	return ok(w, id)
}
func (s *Server) conversationExpenseLinks(w http.ResponseWriter, r *http.Request) error {
	expenses := []Expense{}
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, scope *conversationScope) error {
		a, e := communicationWorkAccess(tx, scope)
		if e != nil {
			return e
		}
		var links []CommunicationExpenseLink
		if e := tx.Where("company_id=? AND conversation_id=?", scope.CompanyID, scope.Conversation.ID).Find(&links).Error; e != nil {
			return e
		}
		for _, link := range links {
			m, e := scopedMessage(tx, scope, link.AnchorMessageID)
			if e != nil || m.Removed {
				continue
			}
			expense, e := scopedExpense(tx, a, link.ExpenseID)
			if e != nil {
				continue
			}
			if expense.TaskID != "" {
				if _, e := scopedTask(tx, a, expense.TaskID); e != nil {
					expense.TaskID = ""
				}
			}
			if expense.ProjectID != "" {
				var p Project
				visible := false
				if e := tx.First(&p, "company_id=? AND id=?", a.Company.ID, expense.ProjectID).Error; e == nil {
					visible, _ = canReadProject(tx, a, p)
				}
				if !visible {
					expense.ProjectID = ""
				}
			}
			expenses = append(expenses, expense)
		}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"expenses": expenses})
}
func (s *Server) communicationFinanceRoutes() {
	s.route("POST /api/companies/{cid}/conversations/{id}/expense-conversions/preview", s.previewExpenseConversion)
	s.route("POST /api/companies/{cid}/conversations/{id}/expense-conversions", s.convertMessageToExpense)
	s.route("GET /api/companies/{cid}/conversations/{id}/expense-links", s.conversationExpenseLinks)
}
