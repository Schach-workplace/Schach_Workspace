// Package platform implements the shared HTTP application for standalone and Encore runtimes.
package platform

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	_ "time/tzdata"

	"gorm.io/gorm"
)

type Options struct {
	ReceiptOCRProvider       ReceiptOCRProvider
	FinanceOCRFingerprint    string
	LocalProviderBudget      LocalProviderBudget
	FinanceIntakeStore       MediaStore
	FinanceScanner           MediaScanner
	FinanceIntakeTTL         time.Duration
	FinanceActorQuotaBytes   int64
	FinanceCompanyQuotaBytes int64
	ReportArtifactStore      ReportArtifactStore
	ReportArtifactTTL        time.Duration
	MetricSink               func(RequestMetric)
	MediaLimitBytes          int64
	MediaUserQuotaBytes      int64
	MediaCompanyQuotaBytes   int64
	MediaRetentionDays       int
	UnusedUploadHours        int
	MessageRetentionDays     int
	MFAEncryptionKey         []byte
	PushSender               PushSender
	LiveKitURL               string
	LiveKitAPIKey            string
	LiveKitAPISecret         string
	MediaStore               MediaStore
	MediaScanner             MediaScanner
	AllowedOrigins           []string
	SecureCookies            bool
	SessionHours             int
}
type Server struct {
	db              *gorm.DB
	opts            Options
	mux             *http.ServeMux
	reportMu        sync.Mutex
	reportSnapshots map[string]*reportSnapshot
	throttleMu      sync.Mutex
	throttles       map[string]loginAttempt
}
type loginAttempt struct {
	Count int
	Until time.Time
}
type apiError struct {
	Status  int
	Code    string
	Message string
	Rows    []RowError
}
type RowError struct {
	Row     int    `json:"row"`
	Message string `json:"message"`
}

func (e *apiError) Error() string { return e.Message }
func invalid(s string) error      { return &apiError{Status: 422, Code: "validation", Message: s} }
func denied() error {
	return &apiError{Status: 403, Code: "forbidden", Message: "Your role does not permit this action."}
}
func missing() error {
	return &apiError{Status: 404, Code: "not_found", Message: "This resource was not found in your accessible workspace."}
}
func conflict() error {
	return &apiError{Status: 409, Code: "version_conflict", Message: "This task changed since you opened it. Refresh and retry your edit intentionally."}
}
func newID(prefix string) string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return prefix + "_" + hex.EncodeToString(b[:])
}
func nowString() string { return time.Now().UTC().Format(time.RFC3339Nano) }
func Migrate(db *gorm.DB) error {
	if err := db.AutoMigrate(&GoalMeasurement{}, &GoalRevision{}, &GoalAudit{}, &FinanceReconciliationAttentionWork{}, &FinanceAssistanceHistory{}, &FinanceReconciliationAllocation{}, &FinanceReconciliationDecision{}, &FinanceStatementPreview{}, &FinanceStatementImport{}, &FinanceStatementRow{}, &FinanceStatementAudit{}, &FinanceDuplicateCandidate{}, &FinanceDuplicateDecision{}, &FinanceExtractionAcceptance{}, &ReceiptExtractionResult{}, &FinanceAssistanceIntake{}, &ReceiptEvidenceFingerprint{}, &FinanceAssistanceJob{}, &ReportScheduleFailure{}, &SavedReportDefinition{}, &SavedReportRevision{}, &ReportSchedule{}, &ReportExportJob{}, &ReportArtifact{}, &ReportDeliveryIntent{}, &HistoricalReportSnapshot{}, &HistoricalReportRow{}, &ReportSnapshotSource{}, &TaskFact{}, &TaskHistoryCoverage{}, &TaskHistoryGap{}, &TaskAcceptanceFact{}, &TaskTimeFact{}, &TaskScheduleProposal{}, &ProjectMilestone{}, &MilestoneAcceptance{}, &MilestoneEvent{}, &TaskTemplate{}, &TaskTemplateApplication{}, &BusinessMutationRetry{}, &Company{}, &User{}, &Membership{}, &Department{}, &Project{}, &Task{}, &Comment{}, &TimeEntry{}, &Attachment{}, &Goal{}, &Activity{}, &Notification{}, &SessionRecord{}, &AutomationRecord{}, &ExpenseCategory{}, &Budget{}, &Expense{}, &ExpenseReceipt{}, &FinanceEvent{}, &Conversation{}, &ConversationMember{}, &ConversationInterval{}, &Message{}, &MessageRevision{}, &CommunicationEvent{}, &CommunicationOutbox{}, &CommunicationInbox{}, &CommunicationAction{}, &CommunicationRetry{}, &CommunicationWorkSource{}, &CommunicationBookmark{}, &CommunicationReaction{}, &CommunicationMedia{}, &CommunicationDevice{}, &CommunicationPreference{}, &CommunicationCall{}, &CommunicationCallGrant{}, &CommunicationRecord{}, &CommunicationRecipient{}, &CommunicationRequest{}, &CommunicationRecordRevision{}, &CommunicationExportAudit{}, &CommunicationCallJob{}, &CommunicationExpenseLink{}, &CommunicationExpenseRetry{}, &CommunicationBlock{}, &CommunicationPin{}, &CommunicationBundle{}, &CommunicationBundleAction{}, &UserMFA{}, &MFARecovery{}, &CommunicationPush{}, &AttentionItem{}, &AttentionRetry{}, &AttentionPreference{}, &AttentionReminder{}, &AttentionDelivery{}); err != nil {
		return err
	}
	if err := migrateGoalMeasurements(db); err != nil {
		return err
	}
	if err := db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS finance_allocation_active_row ON finance_reconciliation_allocations(company_id,row_id) WHERE active").Error; err != nil {
		return err
	}
	if err := db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS finance_allocation_active_expense ON finance_reconciliation_allocations(company_id,expense_id) WHERE active").Error; err != nil {
		return err
	}
	return db.Exec("INSERT INTO finance_reconciliation_attention_works(company_id,revision,processed_revision,cursor,updated_at) SELECT DISTINCT company_id,1,0,'',? FROM finance_statement_rows r WHERE NOT EXISTS(SELECT 1 FROM finance_reconciliation_attention_works w WHERE w.company_id=r.company_id)", time.Now().UTC()).Error
}
func New(db *gorm.DB, opts Options) (*Server, error) {
	if db == nil {
		return nil, errors.New("database is required")
	}
	if opts.LocalProviderBudget == nil {
		opts.LocalProviderBudget = processLocalProviderBudget
	}
	if opts.FinanceIntakeTTL == 0 {
		opts.FinanceIntakeTTL = 7 * 24 * time.Hour
	}
	if opts.FinanceActorQuotaBytes == 0 {
		opts.FinanceActorQuotaBytes = 50 << 20
	}
	if opts.FinanceCompanyQuotaBytes == 0 {
		opts.FinanceCompanyQuotaBytes = 500 << 20
	}
	if opts.FinanceIntakeTTL < 24*time.Hour || opts.FinanceIntakeTTL > 30*24*time.Hour || opts.FinanceActorQuotaBytes < 10<<20 || opts.FinanceCompanyQuotaBytes < opts.FinanceActorQuotaBytes || opts.FinanceActorQuotaBytes > 500<<20 || opts.FinanceCompanyQuotaBytes > 500<<20 {
		return nil, errors.New("Invalid finance scratch bounds")
	}
	if opts.MediaLimitBytes == 0 {
		opts.MediaLimitBytes = 25 << 20
	}
	if opts.MediaUserQuotaBytes == 0 {
		opts.MediaUserQuotaBytes = 500 << 20
	}
	if opts.MediaCompanyQuotaBytes == 0 {
		opts.MediaCompanyQuotaBytes = 25 << 30
	}
	if opts.MediaRetentionDays == 0 {
		opts.MediaRetentionDays = 90
	}
	if opts.UnusedUploadHours == 0 {
		opts.UnusedUploadHours = 24
	}
	if opts.MessageRetentionDays == 0 {
		opts.MessageRetentionDays = 365
	}
	if opts.MediaLimitBytes < 1 || opts.MediaLimitBytes > 100<<20 || opts.MediaUserQuotaBytes < opts.MediaLimitBytes || opts.MediaCompanyQuotaBytes < opts.MediaUserQuotaBytes || opts.MediaRetentionDays < 1 || opts.UnusedUploadHours < 1 || opts.MessageRetentionDays < 1 {
		return nil, errors.New("Invalid communication capacity or retention limits")
	}
	if opts.ReportArtifactTTL == 0 {
		opts.ReportArtifactTTL = 7 * 24 * time.Hour
	}
	if opts.ReportArtifactTTL < time.Hour || opts.ReportArtifactTTL > 365*24*time.Hour {
		return nil, errors.New("ReportArtifactTTL must be 1 hour–365 days")
	}
	if opts.SessionHours == 0 {
		opts.SessionHours = 72
	}
	if opts.SessionHours < 1 || opts.SessionHours > 24*30 {
		return nil, errors.New("SessionHours must be 1–720")
	}
	for _, origin := range opts.AllowedOrigins {
		u, err := url.Parse(origin)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
			return nil, fmt.Errorf("invalid allowed origin %q; use scheme://host[:port]", origin)
		}
	}
	s := &Server{db: db.Session(&gorm.Session{Logger: measuredLogger{}}), opts: opts, mux: http.NewServeMux(), throttles: map[string]loginAttempt{}}
	s.routes()
	return s, nil
}

type endpoint func(http.ResponseWriter, *http.Request) error

func (s *Server) route(pattern string, fn endpoint) {
	s.mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		begin := time.Now()
		queries := &queryMeasurement{}
		measured := &measuredResponse{ResponseWriter: w}
		r = r.WithContext(context.WithValue(r.Context(), measurementKey{}, queries))
		defer func() {
			queries.mu.Lock()
			count, duration, rows := queries.count, queries.duration, queries.rows
			queries.mu.Unlock()
			metric := RequestMetric{Endpoint: pattern, Status: measured.status, Bytes: measured.bytes, Duration: time.Since(begin), Queries: count, QueryDuration: duration, QueryRows: rows}
			if s.opts.MetricSink != nil {
				s.opts.MetricSink(metric)
			} else {
				slog.Debug("endpoint metrics", "endpoint", metric.Endpoint, "status", metric.Status, "bytes", metric.Bytes, "duration_ms", float64(metric.Duration.Microseconds())/1000, "queries", metric.Queries, "query_rows", metric.QueryRows, "query_ms", float64(metric.QueryDuration.Microseconds())/1000)
			}
		}()
		w = measured
		if err := fn(w, r); err != nil {
			if measured.status == 0 {
				s.writeError(w, err)
			} else {
				slog.Error("response interrupted", "endpoint", pattern)
			}
		}
	})
}
func (s *Server) routes() {
	s.financeIntakeRoutes()
	s.financeExtractionRoutes()
	s.receiptAcceptanceRoutes()
	s.financeDuplicateRoutes()
	s.financeStatementRoutes()
	s.financeReconciliationRoutes()
	s.reportExportRoutes()
	s.savedReportRoutes()
	s.historicalReportRoutes()
	s.communicationRoutes()
	s.templateRoutes()
	s.milestoneRoutes()
	s.scheduleRoutes()
	s.attentionRoutes()
	s.route("GET /api/health", func(w http.ResponseWriter, r *http.Request) error {
		db, e := s.db.DB()
		if e != nil {
			return e
		}
		if e = db.PingContext(r.Context()); e != nil {
			return &apiError{503, "unavailable", "Database unavailable.", nil}
		}
		return respond(w, 200, map[string]any{"ok": true})
	})
	s.route("POST /api/auth/login", s.login)
	s.route("GET /api/auth/session", s.session)
	s.route("POST /api/auth/logout", s.logout)
	s.route("POST /api/auth/password", s.changePassword)
	s.route("GET /api/companies", s.companies)
	s.route("POST /api/companies", s.createCompany)
	s.route("PATCH /api/companies/{cid}", s.patchCompany)
	s.route("GET /api/companies/{cid}/workspace", s.workspace)
	s.route("GET /api/companies/{cid}/bootstrap", s.bootstrap)
	s.route("GET /api/companies/{cid}/tasks", s.taskList)
	s.route("GET /api/companies/{cid}/tasks/{id}", s.taskDetail)
	s.route("GET /api/companies/{cid}/tasks/{id}/{kind}", s.taskEvidence)
	s.route("GET /api/companies/{cid}/finance/events", s.financeEvents)
	s.route("GET /api/companies/{cid}/expenses", s.expenseList)
	s.route("GET /api/companies/{cid}/expenses/{id}", s.expenseDetail)
	s.route("GET /api/companies/{cid}/expenses/{id}/receipts", s.expenseEvidence)
	s.route("GET /api/companies/{cid}/reports/tasks/summary", s.reportSummary)
	s.route("GET /api/companies/{cid}/reports/tasks/rows", s.reportRows)
	s.route("GET /api/companies/{cid}/reports/tasks/export", s.reportExport)
	s.route("GET /api/companies/{cid}/reports/tasks", s.taskReport)
	s.route("POST /api/companies/{cid}/departments", s.saveDepartment)
	s.route("PATCH /api/companies/{cid}/departments/{id}", s.saveDepartment)
	s.route("POST /api/companies/{cid}/people", s.addPerson)
	s.route("PATCH /api/companies/{cid}/people/{id}", s.patchPerson)
	s.route("POST /api/companies/{cid}/projects", s.saveProject)
	s.route("PATCH /api/companies/{cid}/projects/{id}", s.saveProject)
	s.route("GET /api/companies/{cid}/planning/warnings", s.planningWarnings)
	s.route("GET /api/companies/{cid}/planning/schedule-seed", s.planningScheduleSeed)
	s.route("GET /api/companies/{cid}/planning/summary", s.planningSummary)
	s.route("GET /api/companies/{cid}/planning/tasks", s.planningTasks)
	s.route("GET /api/companies/{cid}/goals", s.goalsList)
	s.route("GET /api/companies/{cid}/goals/{id}", s.goalDetail)
	s.route("GET /api/companies/{cid}/goals/{id}/measurements", s.goalHistory)
	s.route("POST /api/companies/{cid}/goals/{id}/measurements", s.goalMeasurement)
	s.route("POST /api/companies/{cid}/goals", s.saveGoal)
	s.route("PATCH /api/companies/{cid}/goals/{id}", s.saveGoal)
	s.route("POST /api/companies/{cid}/tasks", s.createTask)
	s.route("PATCH /api/companies/{cid}/tasks/{id}", s.patchTask)
	s.route("POST /api/companies/{cid}/tasks/import", s.importTasks)
	s.route("POST /api/companies/{cid}/tasks/{id}/comments", s.addComment)
	s.route("POST /api/companies/{cid}/tasks/{id}/time", s.addTime)
	s.route("POST /api/companies/{cid}/tasks/{id}/review", s.reviewTask)
	s.route("POST /api/companies/{cid}/tasks/{id}/nudge", s.nudge)
	s.route("POST /api/companies/{cid}/tasks/{id}/attachments", s.upload)
	s.route("GET /api/companies/{cid}/attachments/{id}", s.download)
	s.route("POST /api/companies/{cid}/notifications/read", s.readNotifications)
	s.route("POST /api/companies/{cid}/automations/run", s.runAutomationsHTTP)
	s.route("POST /api/companies/{cid}/expense-categories", s.saveExpenseCategory)
	s.route("PATCH /api/companies/{cid}/expense-categories/{id}", s.saveExpenseCategory)
	s.route("POST /api/companies/{cid}/budgets", s.saveBudget)
	s.route("PATCH /api/companies/{cid}/budgets/{id}", s.saveBudget)
	s.route("POST /api/companies/{cid}/expenses", s.createExpense)
	s.route("PATCH /api/companies/{cid}/expenses/{id}", s.patchExpense)
	s.route("POST /api/companies/{cid}/expenses/{id}/transition", s.transitionExpense)
	s.route("POST /api/companies/{cid}/expenses/{id}/receipts", s.uploadExpenseReceipt)
	s.route("GET /api/companies/{cid}/expense-receipts/{id}", s.downloadExpenseReceipt)
	s.route("/api/", func(w http.ResponseWriter, r *http.Request) error { return missing() })
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "same-origin")
	origin := r.Header.Get("Origin")
	allowed := origin == ""
	if origin != "" {
		u, err := url.Parse(origin)
		allowed = err == nil && u.Host == r.Host && ((r.TLS != nil && u.Scheme == "https") || (r.TLS == nil && u.Scheme == "http"))
		for _, v := range s.opts.AllowedOrigins {
			if origin == v {
				allowed = true
			}
		}
	}
	unsafe := r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS"
	if (unsafe || r.Method == "OPTIONS") && (!allowed || (origin == "" && r.Header.Get("Sec-Fetch-Site") == "cross-site")) {
		s.writeError(w, &apiError{403, "origin_rejected", "Request origin is not allowed.", nil})
		return
	}
	if origin != "" && allowed {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Add("Vary", "Origin")
	}
	if r.Method == "OPTIONS" {
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.WriteHeader(204)
		return
	}
	defer func() {
		if v := recover(); v != nil {
			slog.Error("request panic")
			s.writeError(w, errors.New("internal error"))
		}
	}()
	s.mux.ServeHTTP(w, r)
}
func (s *Server) writeError(w http.ResponseWriter, err error) {
	var a *apiError
	if !errors.As(err, &a) {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			a = &apiError{404, "not_found", "Resource not found.", nil}
		} else {
			slog.Error("request failed", "code", "internal_error")
			a = &apiError{500, "internal_error", "The operation could not be completed. Please try again.", nil}
		}
	}
	data := map[string]any{"code": a.Code, "message": a.Message}
	if len(a.Rows) > 0 {
		data["rows"] = a.Rows
	}
	_ = respond(w, a.Status, map[string]any{"error": data})
}
func respond(w http.ResponseWriter, status int, v any) error {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	return json.NewEncoder(w).Encode(v)
}
func ok(w http.ResponseWriter, id string) error {
	v := map[string]any{"ok": true}
	if id != "" {
		v["id"] = id
	}
	return respond(w, 200, v)
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return &apiError{400, "invalid_json", "Invalid JSON body: " + err.Error(), nil}
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return &apiError{400, "invalid_json", "Send exactly one JSON object.", nil}
	}
	return nil
}
func audit(db *gorm.DB, cid, tid, uid, action, detail string) error {
	return db.Create(&Activity{ID: newID("act"), CompanyID: cid, TaskID: tid, UserID: uid, Action: action, Detail: detail, CreatedAt: nowString()}).Error
}
func notification(db *gorm.DB, cid, tid, uid, title, body, kind string) error {
	if uid == "" {
		return nil
	}
	return db.Create(&Notification{ID: newID("not"), CompanyID: cid, TaskID: tid, UserID: uid, Title: title, Body: body, Kind: kind, CreatedAt: nowString()}).Error
}
func validDate(v string) bool {
	if v == "" {
		return true
	}
	t, e := time.Parse("2006-01-02", v)
	return e == nil && t.Format("2006-01-02") == v && t.Year() >= 1900 && t.Year() <= 2200
}
func in(v string, vals ...string) bool {
	for _, x := range vals {
		if v == x {
			return true
		}
	}
	return false
}
func clean(s string, max int) bool { return len(strings.TrimSpace(s)) > 0 && len(s) <= max }
func person(u User, m Membership) Person {
	return Person{ID: u.ID, MembershipID: m.ID, Name: u.Name, Email: u.Email, Role: m.Role, DepartmentID: m.DepartmentID, ManagerID: m.ManagerID, Title: m.Title, CapacityHours: m.CapacityHours, Avatar: m.Avatar, Active: m.Active}
}
