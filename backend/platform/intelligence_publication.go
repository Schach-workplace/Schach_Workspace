package platform

import (
	"encoding/json"
	"gorm.io/gorm"
	"net/http"
	"sort"
	"time"
)

type IntelligenceBasis struct {
	JobID         string `json:"jobId"`
	ResultHash    string `json:"resultHash"`
	SourceSetHash string `json:"sourceSetHash"`
	ReviewHash    string `json:"reviewHash,omitempty"`
}

func flattenIntelligenceManifest(tx *gorm.DB, m SourceManifest) (SourceManifest, error) {
	out := SourceManifest{Sources: []BoundIntelligenceSource{}, SourceSetHash: m.SourceSetHash, ExpiresAt: m.ExpiresAt}
	seen := map[string]bool{}
	for _, b := range m.Sources {
		if b.Request.Kind == "transcript" {
			var j IntelligenceJob
			if e := tx.Omit("result_json").First(&j, "id=? AND company_id=?", b.Request.ID, b.CompanyID).Error; e != nil {
				return out, missing()
			}
			roots, e := loadIntelligenceManifest(tx, j)
			if e != nil {
				return out, e
			}
			for _, root := range roots.Sources {
				if root.Request.Kind == "transcript" {
					return out, missing()
				}
				if !seen[root.SourceKey] {
					out.Sources = append(out.Sources, root)
					seen[root.SourceKey] = true
				}
			}
		} else if !seen[b.SourceKey] {
			out.Sources = append(out.Sources, b)
			seen[b.SourceKey] = true
		}
	}
	sort.Slice(out.Sources, func(i, j int) bool { return out.Sources[i].SourceKey < out.Sources[j].SourceKey })
	return out, nil
}
func (s *Server) intelligencePublicationManifest(tx *gorm.DB, a *access, basis *IntelligenceBasis, exact bool) (SourceManifest, error) {
	empty := SourceManifest{}
	if basis == nil {
		return empty, nil
	}
	if basis.JobID == "" || !goalHashPattern.MatchString(basis.ResultHash) || !goalHashPattern.MatchString(basis.SourceSetHash) {
		return empty, invalid("Choose a current reviewed intelligence draft.")
	}
	var j IntelligenceJob
	if e := tx.Omit("result_json").First(&j, "id=? AND company_id=? AND actor_id=?", basis.JobID, a.Company.ID, a.User.ID).Error; e != nil {
		return empty, missing()
	}
	if j.Operation != "action_draft" || j.ResultHash != basis.ResultHash || j.SourceSetHash != basis.SourceSetHash {
		return empty, conflict()
	}
	m, e := loadIntelligenceManifest(tx, j)
	if e != nil {
		return empty, e
	}
	if exact {
		if j.State != "ready" || !j.ExpiresAt.After(time.Now()) {
			return empty, conflict()
		}
		if e = intelligenceOriginalAuthority(tx, a, j); e != nil {
			return empty, e
		}
		if e = s.authorizeIntelligenceSources(tx, a, m, IntelligenceExactCurrent); e != nil {
			return empty, e
		}
	}
	m, e = flattenIntelligenceManifest(tx, m)
	if e != nil {
		return empty, e
	}
	if e = s.authorizeIntelligenceSources(tx, a, m, IntelligenceCurrentACL); e != nil {
		return empty, e
	}
	return m, nil
}
func intelligencePublicationScope(m SourceManifest, conversationID string, messageIDs []string) error {
	private := map[string]bool{}
	roots := map[string]bool{}
	for _, b := range m.Sources {
		if b.Request.ConversationID != "" {
			private[b.Request.ConversationID] = true
			id := b.Request.ID
			if b.Request.Kind != "message" {
				id = b.Request.ParentID
			}
			roots[id] = true
		}
	}
	if len(private) > 1 {
		return invalid("A draft combining private conversations is read-only.")
	}
	if conversationID == "" {
		if len(private) > 0 {
			return denied()
		}
		return nil
	}
	if len(private) != 1 || !private[conversationID] {
		return denied()
	}
	if messageIDs != nil {
		provided := map[string]bool{}
		for _, id := range messageIDs {
			provided[id] = true
		}
		if len(provided) != len(roots) {
			return invalid("Review every contributing source.")
		}
		for id := range roots {
			if !provided[id] {
				return invalid("Review every contributing source.")
			}
		}
	}
	return nil
}
func intelligenceReviewedHash(a *access, basis *IntelligenceBasis, payload any, audience []string) string {
	if basis == nil {
		return ""
	}
	raw, _ := json.Marshal(payload)
	var value map[string]any
	json.Unmarshal(raw, &value)
	delete(value, "retryKey")
	if b, ok := value["intelligenceBasis"].(map[string]any); ok {
		delete(b, "reviewHash")
	}
	audience = append([]string(nil), audience...)
	sort.Strings(audience)
	hash, _ := intelligenceHash([]any{a.Company.ID, a.User.ID, a.Company.PermissionEpoch, basis.JobID, basis.ResultHash, basis.SourceSetHash, value, audience})
	return hash
}
func (s *Server) intelligencePublicationAccess(tx *gorm.DB, a *access, b *IntelligenceBasis, conversationID string, ids []string) error {
	if b == nil {
		return nil
	}
	m, e := s.intelligencePublicationManifest(tx, a, b, false)
	if e != nil {
		return e
	}
	return intelligencePublicationScope(m, conversationID, ids)
}
func (s *Server) intelligencePublicationFirstWrite(tx *gorm.DB, a *access, b *IntelligenceBasis, conversationID string, ids []string, payload any, audience []string) error {
	if b == nil {
		return nil
	}
	m, e := s.intelligencePublicationManifest(tx, a, b, true)
	if e != nil {
		return e
	}
	if e = intelligencePublicationScope(m, conversationID, ids); e != nil {
		return e
	}
	if b.ReviewHash == "" || b.ReviewHash != intelligenceReviewedHash(a, b, payload, audience) {
		return conflict()
	}
	return nil
}
func (s *Server) recordIntelligencePublication(tx *gorm.DB, a *access, b *IntelligenceBasis, kind, id, operation, key string, payload any, outcome ...string) error {
	if b == nil {
		return nil
	}
	m, e := s.intelligencePublicationManifest(tx, a, b, false)
	if e != nil {
		return e
	}
	hash, e := intelligenceHash(payload)
	if e != nil {
		return e
	}
	resultOutcome := "created"
	if len(outcome) > 0 {
		resultOutcome = outcome[0]
	}
	return tx.Create(&IntelligencePublication{Outcome: resultOutcome, ID: newID("ipub"), JobID: b.JobID, CompanyID: a.Company.ID, ActorID: a.User.ID, ResultHash: b.ResultHash, DestinationKind: kind, CanonicalResultID: id, CanonicalOperation: operation, RetryKey: key, ReviewedPayloadHash: hash, Manifest: m}).Error
}
func conversionIntelligenceMessages(input ConversionInput) []string {
	ids := []string{}
	for _, source := range input.Sources {
		ids = append(ids, source.MessageID)
	}
	return ids
}
func (s *Server) intelligenceTaskPreview(w http.ResponseWriter, r *http.Request) error {
	w.Header().Set("Cache-Control", "no-store")
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input struct {
		Task              map[string]json.RawMessage `json:"task"`
		IntelligenceBasis *IntelligenceBasis         `json:"intelligenceBasis"`
	}
	if e = decodeIntelligence(w, r, &input); e != nil {
		return e
	}
	if input.IntelligenceBasis == nil || input.IntelligenceBasis.JobID != r.PathValue("id") {
		return invalid("Choose an intelligence draft.")
	}
	var audience []string
	hash := ""
	e = s.withIntelligenceAccessTransaction(r, a, func(tx *gorm.DB) error {
		m, e := s.intelligencePublicationManifest(tx, a, input.IntelligenceBasis, true)
		if e != nil {
			return e
		}
		if e = intelligencePublicationScope(m, "", nil); e != nil {
			return e
		}
		for key := range input.Task {
			if !in(key, createTaskFields...) {
				return invalid("Unknown task field.")
			}
		}
		task, e := makeTask(a, input.Task)
		if e != nil {
			return e
		}
		if e = validateTask(tx, a, &task); e != nil {
			return e
		}
		if !a.canCreate(task.OwnerID, task.DepartmentID) {
			return denied()
		}
		audience = taskAudience(a, task)
		payload := map[string]any{}
		for key, value := range input.Task {
			payload[key] = value
		}
		payload["intelligenceBasis"] = input.IntelligenceBasis
		hash = intelligenceReviewedHash(a, input.IntelligenceBasis, payload, audience)
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"audienceUserIds": audience, "intelligenceReviewHash": hash, "notice": "Confirm these authored task fields for the listed work audience. Roles may change the audience later."})
}
func intelligenceExpenseAudience(a *access, expense Expense) []string {
	out := []string{}
	for uid, member := range a.Members {
		other := *a
		other.Member = member
		other.User = a.Users[uid]
		if member.Active && other.canReadExpense(expense) {
			out = append(out, uid)
		}
	}
	return out
}
func intelligenceIntakeAudience(a *access, item CommunicationRequest) []string {
	out := []string{}
	for uid, member := range a.Members {
		other := *a
		other.Member = member
		other.User = a.Users[uid]
		if member.Active && other.canReadIntake(item) {
			out = append(out, uid)
		}
	}
	return out
}
func intelligencePublicationView(tx *gorm.DB, a *access, m SourceManifest) map[string]any {
	conv := ""
	policy := int64(0)
	sources := []map[string]any{}
	seen := map[string]bool{}
	for _, b := range m.Sources {
		if b.Request.ConversationID == "" {
			continue
		}
		if conv != "" && conv != b.Request.ConversationID {
			return map[string]any{"allowed": false}
		}
		conv = b.Request.ConversationID
		policy = b.PolicyVersion
		id := b.Request.ID
		if b.Request.Kind != "message" {
			id = b.Request.ParentID
		}
		if !seen[id] {
			var message Message
			if e := tx.First(&message, "id=? AND company_id=? AND conversation_id=?", id, a.Company.ID, conv).Error; e != nil {
				return map[string]any{"allowed": false}
			}
			sources = append(sources, map[string]any{"messageId": id, "revision": message.Revision})
			seen[id] = true
		}
	}
	return map[string]any{"allowed": true, "conversationId": conv, "policyVersion": policy, "sources": sources}
}

// Publication retries have a current permission check independent of raw result
// lifetime. Only minimal committed provenance is read; generated text never is.
func (s *Server) intelligencePublicationCurrent(w http.ResponseWriter, r *http.Request) error {
	w.Header().Set("Cache-Control", "no-store")
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input struct {
		Basis     *IntelligenceBasis `json:"intelligenceBasis"`
		RetryKey  string             `json:"retryKey"`
		Operation string             `json:"operation"`
	}
	if e = decodeIntelligence(w, r, &input); e != nil {
		return e
	}
	if input.Basis == nil || input.Basis.JobID != r.PathValue("id") || !clean(input.RetryKey, 100) || !inString(input.Operation, "task_create", "task_conversion", "expense_conversion", "request_publish") {
		return invalid("Choose the original submitted draft.")
	}
	committed := false
	e = s.withIntelligenceAccessTransaction(r, a, func(tx *gorm.DB) error {
		var publication IntelligencePublication
		e := tx.First(&publication, "job_id=? AND company_id=? AND actor_id=? AND canonical_operation=? AND retry_key=?", input.Basis.JobID, a.Company.ID, a.User.ID, input.Operation, input.RetryKey).Error
		if e == gorm.ErrRecordNotFound {
			_, e = s.intelligencePublicationManifest(tx, a, input.Basis, true)
			if e != nil {
				return intelligenceError(403, "source_unavailable")
			}
			return nil
		}
		if e != nil {
			return e
		}
		if publication.ResultHash != input.Basis.ResultHash || publication.Manifest.SourceSetHash != input.Basis.SourceSetHash {
			return conflict()
		}
		if e = s.authorizeIntelligenceSources(tx, a, publication.Manifest, IntelligenceCurrentACL); e != nil {
			return intelligenceError(403, "source_unavailable")
		}
		switch publication.DestinationKind {
		case "task":
			e = authorizeTaskResults(tx, a, BusinessResult{Kind: "task", IDs: []string{publication.CanonicalResultID}})
		case "expense":
			_, e = scopedExpense(tx, a, publication.CanonicalResultID)
		case "intake":
			var item CommunicationRequest
			e = tx.First(&item, "id=? AND company_id=?", publication.CanonicalResultID, a.Company.ID).Error
			if e == nil && !a.canReadIntake(item) {
				e = missing()
			}
		default:
			return missing()
		}
		if e != nil {
			return intelligenceError(403, "source_unavailable")
		}
		committed = true
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"current": true, "committed": committed})
}
