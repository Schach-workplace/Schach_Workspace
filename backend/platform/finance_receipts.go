package platform

import (
	"io"
	"mime"
	"net/http"
	"strconv"

	"gorm.io/gorm"
)

func readExpenseReceipt(w http.ResponseWriter, r *http.Request) (ExpenseReceipt, error) {
	var receipt ExpenseReceipt
	r.Body = http.MaxBytesReader(w, r.Body, maxUpload+(1<<20))
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		return receipt, &apiError{413, "invalid_upload", "Upload a multipart receipt no larger than 10 MiB.", nil}
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	f, h, err := r.FormFile("file")
	if err != nil {
		return receipt, invalid("Choose a receipt in the multipart field named file.")
	}
	defer f.Close()
	if h.Size > maxUpload {
		return receipt, &apiError{413, "file_too_large", "Receipt exceeds the 10 MiB limit.", nil}
	}
	data, err := io.ReadAll(io.LimitReader(f, maxUpload+1))
	if err != nil {
		return receipt, err
	}
	if len(data) > maxUpload {
		return receipt, &apiError{413, "file_too_large", "Receipt exceeds the 10 MiB limit.", nil}
	}
	if len(data) == 0 {
		return receipt, invalid("The receipt is empty.")
	}
	name := safeFileName(h.Filename)
	if name == "" || name == "." {
		return receipt, invalid("Choose a valid receipt file name.")
	}
	contentType, err := uploadType(name, data)
	if err != nil {
		return receipt, err
	}
	receipt = ExpenseReceipt{ID: newID("rcp"), FileName: name, MimeType: contentType, Size: int64(len(data)), CreatedAt: nowString(), Data: data}
	return receipt, nil
}
func (s *Server) uploadExpenseReceipt(w http.ResponseWriter, r *http.Request) error {
	a, err := s.access(r)
	if err != nil {
		return err
	}
	e, err := scopedExpense(s.db.WithContext(r.Context()), a, r.PathValue("id"))
	if err != nil {
		return err
	}
	if e.CreatedBy != a.User.ID && !financeAuthority(a.Member.Role) {
		return denied()
	}
	receipt, err := readExpenseReceipt(w, r)
	if err != nil {
		return err
	}
	err = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		e, err := scopedExpense(tx, a, r.PathValue("id"))
		if err != nil {
			return err
		}
		if e.CreatedBy != a.User.ID && !financeAuthority(a.Member.Role) {
			return denied()
		}
		receipt.CompanyID = e.CompanyID
		receipt.ExpenseID = e.ID
		receipt.UploadedBy = a.User.ID
		if err = tx.Create(&receipt).Error; err != nil {
			return err
		}
		// Additive evidence has no client version precondition. The lock protects
		// concurrent appends and invalidates every earlier financial decision view.
		result := tx.Model(&Expense{}).Where("id = ? AND company_id = ?", e.ID, e.CompanyID).Updates(map[string]any{"version": gorm.Expr("version + 1"), "updated_at": nowString()})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return missing()
		}
		if err := staleFinanceDuplicates(tx, e.CompanyID, e.ID); err != nil {
			return err
		}
		if e.Status == "paid" {
			if err := markFinanceReconciliationDirty(tx, e.CompanyID); err != nil {
				return err
			}
		}
		return financeEvent(tx, e.CompanyID, e.DepartmentID, "expense", e.ID, a.User.ID, "receipt_uploaded", receipt.FileName+" ("+strconv.FormatInt(receipt.Size, 10)+" bytes) appended to "+e.Code+"; financial fields remain unchanged.")
	})
	if err != nil {
		return err
	}
	return ok(w, receipt.ID)
}
func (s *Server) downloadExpenseReceipt(w http.ResponseWriter, r *http.Request) error {
	a, err := s.access(r)
	if err != nil {
		return err
	}
	db := s.db.WithContext(r.Context())
	var receipt ExpenseReceipt
	if err = db.Omit("Data").Where("id = ? AND company_id = ?", r.PathValue("id"), a.Company.ID).First(&receipt).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return missing()
		}
		return err
	}
	if _, err = scopedExpense(db, a, receipt.ExpenseID); err != nil {
		return err
	}
	if err = db.Select("data").Where("id = ? AND company_id = ?", receipt.ID, a.Company.ID).First(&receipt).Error; err != nil {
		return err
	}
	w.Header().Set("Content-Type", receipt.MimeType)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": receipt.FileName}))
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.Header().Set("Content-Length", strconv.Itoa(len(receipt.Data)))
	w.WriteHeader(200)
	_, err = w.Write(receipt.Data)
	return err
}
