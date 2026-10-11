package platform

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
)

func intelligenceError(status int, code string) error {
	return &apiError{status, code, "Local assistance is unavailable for this selection. Reselect current sources or continue manually.", nil}
}
func intelligenceHash(value any) (string, error) {
	b, e := json.Marshal(value)
	if e != nil {
		return "", e
	}
	// Normalize typed structures to sorted JSON object keys without floating-point coercion.
	d := json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	var v any
	if e = d.Decode(&v); e != nil {
		return "", e
	}
	b, e = json.Marshal(v)
	if e != nil {
		return "", e
	}
	sum := sha256.Sum256(append([]byte("schach/intelligence/v1\n"), b...))
	return hex.EncodeToString(sum[:]), nil
}
func intelligenceSourceKey(r IntelligenceSourceRequest) string {
	h, _ := intelligenceHash([]string{r.Kind, r.ParentID, r.ConversationID, r.ID, r.SelectedFieldSet})
	return "s_" + h[:32]
}
func normalizedIntelligenceSelection(in IntelligenceSelection) (IntelligenceSelection, error) {
	if !inOperation(in.Operation) || len(in.Sources) == 0 || len(in.Sources) > 50 || len(in.Language) > 16 {
		return in, invalid("Choose an operation and 1–50 explicit sources.")
	}
	if in.Operation == "transcript" && len(in.Sources) != 1 {
		return in, invalid("Select exactly one attached audio recording.")
	}
	for _, r := range in.Language {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r == '-') {
			return in, invalid("Choose a language code.")
		}
	}
	in.Sources = append([]IntelligenceSourceRequest(nil), in.Sources...)
	sort.Slice(in.Sources, func(i, j int) bool {
		return intelligenceSourceKey(in.Sources[i]) < intelligenceSourceKey(in.Sources[j])
	})
	seen := map[string]bool{}
	for _, r := range in.Sources {
		if r.ID == "" || len(r.ID) > 100 || len(r.ParentID) > 100 || len(r.ConversationID) > 100 || r.ExpectedRevision < 0 || r.ExpectedVersion < 0 || r.ExpectedContentHash != "" && !goalHashPattern.MatchString(r.ExpectedContentHash) {
			return in, invalid("Choose valid exact source bindings.")
		}
		fields := map[string][]string{"message": {"body"}, "voice_media": {"audio"}, "record": {"content", "content_responses"}, "task_fields": {"narrative"}, "task_comment": {"body"}, "expense_fields": {"economics"}, "goal_fields": {"measurement"}, "goal_measurement": {"measurement", "measurement_evidence"}, "planning_projection": {"capacity"}, "report_current": {"metrics"}, "report_snapshot": {"metrics"}, "transcript": {"segments"}}
		if !containsString(fields[r.Kind], r.SelectedFieldSet) {
			return in, invalid("Choose a supported source field set.")
		}
		switch in.Operation {
		case "transcript":
			if r.Kind != "voice_media" {
				return in, invalid("Choose attached audio.")
			}
		case "summary", "action_draft":
			if !inString(r.Kind, "message", "record", "transcript", "task_fields", "task_comment") {
				return in, invalid("Choose narrative sources.")
			}
		case "report_explanation":
			if !inString(r.Kind, "expense_fields", "goal_fields", "goal_measurement", "planning_projection", "report_current", "report_snapshot") {
				return in, invalid("Choose deterministic facts.")
			}
		}
		key := intelligenceSourceKey(r)
		if seen[key] {
			return in, invalid("Choose each source once.")
		}
		seen[key] = true
		if r.Kind != "planning_projection" && r.Filters != nil {
			return in, invalid("Unexpected source filters.")
		}
	}
	return in, nil
}
func inOperation(o IntelligenceOperation) bool {
	return inString(string(o), "transcript", "summary", "action_draft", "report_explanation")
}
func inString(s string, values ...string) bool { return containsString(values, s) }
func containsString(v []string, s string) bool {
	for _, x := range v {
		if x == s {
			return true
		}
	}
	return false
}
func hashIntelligenceIntent(input IntelligenceEnqueue, config ProviderIdentity) (string, string, error) {
	selection, e := normalizedIntelligenceSelection(input.IntelligenceSelection)
	if e != nil {
		return "", "", e
	}
	intent := map[string]any{"selection": selection, "selectionHash": input.SelectionHash, "optIn": input.OptIn, "schemaVersion": 1}
	client, e := intelligenceHash(intent)
	if e != nil {
		return "", "", e
	}
	effective, e := intelligenceHash([]any{intent, config})
	return client, effective, e
}
func earlierIntelligenceExpiry(a, b time.Time) time.Time {
	if a.IsZero() || !b.IsZero() && b.Before(a) {
		return b
	}
	return a
}

func (s *Server) captureIntelligenceSources(tx *gorm.DB, a *access, request IntelligenceSelection) (SourceManifest, error) {
	manifest := SourceManifest{Sources: []BoundIntelligenceSource{}}
	request, e := normalizedIntelligenceSelection(request)
	if e != nil {
		return manifest, e
	}
	// All conversation locks precede dependent rows, including roots of derived jobs.
	ids := map[string]bool{}
	for _, r := range request.Sources {
		if r.ConversationID != "" {
			ids[r.ConversationID] = true
		}
		if r.Kind == "goal_measurement" {
			var measurement GoalMeasurement
			if e := tx.First(&measurement, "id=? AND company_id=? AND goal_id=?", r.ID, a.Company.ID, r.ParentID).Error; e != nil {
				return manifest, missing()
			}
			for _, ev := range measurement.Evidence {
				if ev.Kind == "message" {
					ids[ev.ParentID] = true
				}
			}
		}
		if r.Kind == "transcript" {
			var roots []IntelligenceSource
			if e := tx.Where("job_id=? AND company_id=?", r.ID, a.Company.ID).Find(&roots).Error; e != nil {
				return manifest, e
			}
			for _, root := range roots {
				if id := root.Binding.Request.ConversationID; id != "" {
					ids[id] = true
				}
			}
		}
	}
	ordered := []string{}
	for id := range ids {
		ordered = append(ordered, id)
	}
	sort.Strings(ordered)
	for _, id := range ordered {
		var c Conversation
		if e := lockCommunicationRow(tx, "UPDATE").Where("id=? AND company_id=?", id, a.Company.ID).First(&c).Error; e != nil {
			return manifest, missing()
		}
	}
	total, scalars, expanded := 0, 0, 0
	for _, r := range request.Sources {
		b, e := s.captureIntelligenceSource(tx, a, r)
		if e != nil {
			return manifest, e
		}
		if r.ExpectedRevision != 0 && r.ExpectedRevision != b.Revision || r.ExpectedVersion != 0 && r.ExpectedVersion != b.Version || r.ExpectedContentHash != "" && r.ExpectedContentHash != b.ContentHash {
			return manifest, conflict()
		}
		total += len(b.Label) + len(b.Text)
		scalars += utf8.RuneCountInString(b.Label) + utf8.RuneCountInString(b.Text)
		expanded += 1 + len(b.Roots)
		if total > 65536 || scalars > 20000 || expanded > 1000 {
			return manifest, intelligenceError(422, "source_too_large")
		}
		if !b.ExpiresAt.IsZero() && !b.ExpiresAt.After(time.Now()) {
			return manifest, intelligenceError(410, "source_unavailable")
		}
		manifest.ExpiresAt = earlierIntelligenceExpiry(manifest.ExpiresAt, b.ExpiresAt)
		manifest.Sources = append(manifest.Sources, b)
	}
	manifest.SourceSetHash, e = intelligenceHash(manifest.Sources)
	return manifest, e
}
func (s *Server) captureIntelligenceSource(tx *gorm.DB, a *access, r IntelligenceSourceRequest) (BoundIntelligenceSource, error) {
	b := BoundIntelligenceSource{SourceKey: intelligenceSourceKey(r), Request: r, BindingMode: "live_revision", CompanyID: a.Company.ID, SourceSchemaVersion: 1, Roots: []IntelligenceRoot{}}
	// Expected values are input assertions, not part of the server's canonical binding.
	b.Request.ExpectedRevision = 0
	b.Request.ExpectedVersion = 0
	b.Request.ExpectedContentHash = ""
	var value any
	private := inString(r.Kind, "message", "voice_media", "record")
	if !private && r.ConversationID != "" {
		return b, missing()
	}
	if private {
		scope, e := conversationAccess(tx, a.User.ID, a.Company.ID, r.ConversationID)
		if e != nil {
			return b, e
		}
		b.PolicyVersion = scope.Version
		b.MemberEpoch = scope.Epoch
		b.HistoryFromSequence = scope.HistoryFromSequence
		mid := r.ID
		var rec CommunicationRecord
		if r.Kind == "record" {
			rec, e = s.record(tx, scope, r.ID)
			if e != nil {
				return b, e
			}
			if rec.CreatedBy != a.User.ID {
				var count int64
				if e := tx.Model(&CommunicationRecipient{}).Where("company_id=? AND record_id=? AND revision=? AND user_id=?", a.Company.ID, rec.ID, rec.Revision, a.User.ID).Count(&count).Error; e != nil {
					return b, e
				}
				if count != 1 {
					return b, missing()
				}
			}
			mid = rec.AnchorMessageID
			if r.ParentID != mid {
				return b, missing()
			}
		}
		if r.Kind == "voice_media" {
			mid = r.ParentID
		}
		if r.Kind == "message" && r.ParentID != "" {
			return b, missing()
		}
		m, e := scopedMessage(tx, scope, mid)
		if e != nil || m.Removed || m.ContentPurged {
			return b, missing()
		}
		created, e := time.Parse(time.RFC3339Nano, m.CreatedAt)
		if e != nil {
			return b, missing()
		}
		b.ExpiresAt = created.AddDate(0, 0, s.opts.MessageRetentionDays)
		b.Sequence = m.Sequence
		b.Revision = m.Revision
		b.Label = "Selected message"
		b.Text = m.Body
		value = []any{m.ID, m.CompanyID, m.ConversationID, m.Sequence, m.Revision, m.Body, m.Removed, m.ContentPurged}
		switch r.Kind {
		case "voice_media":
			media, e := eligibleCommunicationMedia(tx, scope, r.ID)
			if e != nil || media.State != "clean" || media.MessageID != m.ID || !containsString(m.MediaIDs, media.ID) || media.Size <= 0 || media.Size > 25<<20 || !inString(media.MimeType, "audio/wave", "audio/wav", "audio/x-wav", "video/mp4", "video/webm") {
				return b, missing()
			}
			expiry, e := time.Parse(time.RFC3339Nano, media.ExpiresAt)
			if e != nil {
				return b, missing()
			}
			b.ExpiresAt = earlierIntelligenceExpiry(b.ExpiresAt, expiry)
			b.Label = "Selected audio"
			b.Text = ""
			value = []any{value, media.ID, media.SHA256, media.Size, media.MimeType, media.State, media.ExpiresAt}
			b.Value = media
		case "record":
			b.Revision = rec.Revision
			b.Label = rec.Title
			b.Text = rec.Title + "\n" + rec.Body + "\n" + strings.Join(rec.Options, "\n")
			value = []any{value, rec.ID, rec.Revision, rec.Title, rec.Body, rec.Options, rec.DueAt, rec.State}
			if r.SelectedFieldSet == "content_responses" {
				var responses []CommunicationRecipient
				if e := tx.Where("company_id=? AND record_id=? AND revision=?", a.Company.ID, rec.ID, rec.Revision).Order("user_id").Find(&responses).Error; e != nil {
					return b, e
				}
				value = []any{value, responses}
				encoded, _ := json.Marshal(responses)
				b.Text += "\n" + string(encoded)
			}
		}
	} else {
		switch r.Kind {
		case "task_fields", "task_comment":
			tid := r.ID
			if r.Kind == "task_comment" {
				tid = r.ParentID
			} else if r.ParentID != "" {
				return b, missing()
			}
			t, e := scopedTask(tx, a, tid)
			if e != nil {
				return b, e
			}
			if r.Kind == "task_comment" {
				var c Comment
				if e := tx.Where("id=? AND task_id=? AND company_id=?", r.ID, tid, a.Company.ID).First(&c).Error; e != nil {
					return b, missing()
				}
				b.Label = "Selected task comment"
				b.Text = c.Body
				value = []any{c.ID, c.CompanyID, c.TaskID, c.UserID, c.Body, c.CreatedAt}
			} else {
				b.Version = t.Version
				b.Label = t.Title
				b.Text = t.Title + "\n" + t.Description
				value = map[string]any{"id": t.ID, "version": t.Version, "title": t.Title, "description": t.Description, "status": t.Status, "ownerId": t.OwnerID, "reviewerId": t.ReviewerID, "departmentId": t.DepartmentID, "dueDate": t.DueDate, "dueAt": t.DueAt, "dueTimezone": t.DueTimezone, "deadlineMode": t.DeadlineMode, "originalDueDate": t.OriginalDueDate, "originalDueAt": t.OriginalDueAt, "originalDueTimezone": t.OriginalDueTimezone, "originalDeadlineMode": t.OriginalDeadlineMode}
			}
		case "expense_fields":
			if r.ParentID != "" {
				return b, missing()
			}
			v, e := scopedExpense(tx, a, r.ID)
			if e != nil {
				return b, e
			}
			b.Version = v.Version
			b.Label = v.Title
			value = map[string]any{"id": v.ID, "version": v.Version, "amountMinor": v.AmountMinor, "currency": v.Currency, "expenseDate": v.ExpenseDate, "status": v.Status}
			b.Value = v
		case "goal_fields":
			if r.ParentID != "" {
				return b, missing()
			}
			g, e := scopedGoal(tx, a, r.ID)
			if e != nil {
				return b, e
			}
			b.Version = g.Version
			b.Label = g.Name
			value = []any{g.ID, g.Version, g.Name, g.Unit, g.Baseline, g.Target, g.Current, g.CurrentMeasurementID, g.MeasurementCoverageFrom, g.LegacyObservedCurrent, g.LegacyObservedUnit}
			b.Value = g
		case "goal_measurement":
			g, e := scopedGoal(tx, a, r.ParentID)
			if e != nil {
				return b, e
			}
			var m GoalMeasurement
			if e := tx.First(&m, "id=? AND goal_id=? AND company_id=?", r.ID, g.ID, a.Company.ID).Error; e != nil {
				return b, missing()
			}
			b.BindingMode = "immutable_fact"
			b.Label = "Recorded goal measurement"
			value = []any{m.ID, m.GoalID, m.ActorID, m.Value, m.EffectiveAt, m.Reason, m.CorrectsID, m.CreatedAt, m.GoalVersionAfter, m.Unit, m.Baseline, m.Target, m.Evidence}
			b.Value = m
			// Measurement provenance is all-or-nothing even when the history UI can redact it.
			for _, ev := range m.Evidence {
				if e := authorizeStoredGoalEvidence(tx, a, ev); e != nil {
					return b, e
				}
				ev := ev
				b.Roots = append(b.Roots, IntelligenceRoot{Kind: ev.Kind, ID: ev.SourceID, ParentID: ev.ParentID, Hash: ev.ContentHash, Evidence: &ev})
				if ev.Kind == "report_snapshot" {
					roots, e := intelligenceReportRoots(tx, a, ev.SourceID)
					if e != nil {
						return b, e
					}
					b.Roots = append(b.Roots, roots...)
				}
				if ev.Kind == "message" {
					var m Message
					if e := tx.First(&m, "id=? AND company_id=?", ev.SourceID, a.Company.ID).Error; e != nil {
						return b, e
					}
					created, e := time.Parse(time.RFC3339Nano, m.CreatedAt)
					if e != nil {
						return b, missing()
					}
					b.ExpiresAt = earlierIntelligenceExpiry(b.ExpiresAt, created.AddDate(0, 0, s.opts.MessageRetentionDays))
				}
			}
		case "report_snapshot":
			if r.ParentID != "" {
				return b, missing()
			}
			roots, e := intelligenceReportRoots(tx, a, r.ID)
			if e != nil {
				return b, e
			}
			b.Roots = roots
			var snap HistoricalReportSnapshot
			if e := tx.First(&snap, "id=? AND company_id=? AND requester_id=?", r.ID, a.Company.ID, a.User.ID).Error; e != nil {
				return b, missing()
			}
			var rows []HistoricalReportRow
			if e := tx.Where("snapshot_id=?", snap.ID).Order("row_order,row_id").Limit(1001).Find(&rows).Error; e != nil {
				return b, e
			}
			if len(rows) > 1000 {
				return b, intelligenceError(422, "source_too_large")
			}
			b.BindingMode = "immutable_fact"
			b.Label = "Historical report " + snap.Period.From + " – " + snap.Period.To
			value = []any{snap, rows, roots}
			b.Value = snap
		case "planning_projection":
			if r.ParentID != "" || r.Filters == nil {
				return b, invalid("Choose a bounded planning projection.")
			}
			v, e := loadPlanning(tx, a, *r.Filters, time.Now())
			if e != nil {
				return b, e
			}
			if r.ID != v.ProjectionBasis {
				return b, conflict()
			}
			for _, t := range v.sources {
				b.Roots = append(b.Roots, IntelligenceRoot{Kind: "task", ID: t.ID})
			}
			b.Label = "Recorded capacity projection"
			value = []any{v.ProjectionBasis, v.Method, v.Filters, v.Timezone}
			b.Value = v
		case "report_current":
			if r.ParentID != "" {
				return b, missing()
			}
			s.reportMu.Lock()
			snap := s.reportSnapshots[r.ID]
			s.reportMu.Unlock()
			if snap == nil || snap.Company != a.Company.ID || snap.User != a.User.ID || time.Since(snap.Generated) > 5*time.Minute {
				return b, conflict()
			}
			b.ExpiresAt = snap.Generated.Add(5 * time.Minute)
			b.Label = "Current-state report"
			b.Value = snap
			ids := map[string]bool{}
			for _, t := range snap.Rows {
				current, e := scopedTask(tx, a, t.ID)
				if e != nil {
					return b, e
				}
				if current.Version != t.Version {
					return b, conflict()
				}
				ids[t.ID] = true
				for _, id := range append(append([]string{}, t.Dependencies...), t.ParentID) {
					if id != "" {
						ids[id] = true
					}
				}
			}
			keys := []string{}
			for id := range ids {
				keys = append(keys, id)
			}
			sort.Strings(keys)
			for _, id := range keys {
				if _, e := scopedTask(tx, a, id); e != nil {
					return b, e
				}
				b.Roots = append(b.Roots, IntelligenceRoot{Kind: "task", ID: id})
			}
			value = []any{snap.Token, snap.Generated, snap.Timezone, snap.Filters, snap.Rows, snap.Summary}
		case "transcript":
			if r.ParentID != "" {
				return b, missing()
			}
			var job IntelligenceJob
			if e := tx.Omit("result_json").First(&job, "id=? AND company_id=? AND actor_id=?", r.ID, a.Company.ID, a.User.ID).Error; e != nil {
				return b, missing()
			}
			if job.State != "ready" || job.Operation != "transcript" || !job.ExpiresAt.After(time.Now()) {
				return b, missing()
			}
			if e := intelligenceOriginalAuthority(tx, a, job); e != nil {
				return b, e
			}
			roots, e := loadIntelligenceManifest(tx, job)
			if e != nil {
				return b, e
			}
			if e = s.authorizeIntelligenceSources(tx, a, roots, IntelligenceExactCurrent); e != nil {
				return b, e
			}
			if e := tx.Select("result_json").First(&job, "id=?", job.ID).Error; e != nil {
				return b, e
			}
			var result IntelligenceResult
			if e := json.Unmarshal([]byte(job.ResultJSON), &result); e != nil {
				return b, e
			}
			for _, seg := range result.Segments {
				b.Text += seg.Text + "\n"
			}
			b.Label = "Selected transcript"
			b.BindingMode = "derived_result"
			b.ExpiresAt = job.ExpiresAt
			value = []any{job.ID, job.ResultHash, job.SourceSetHash}
			for _, root := range roots.Sources {
				b.Roots = append(b.Roots, IntelligenceRoot{Kind: root.Request.Kind, ID: root.Request.ID, ParentID: root.Request.ParentID, Hash: root.ContentHash})
				b.Roots = append(b.Roots, root.Roots...)
			}
		default:
			return b, invalid("Unsupported source.")
		}
	}
	if b.Value == nil {
		b.Value = value
	}
	h, e := intelligenceHash(value)
	b.ContentHash = h
	return b, e
}
func intelligenceReportRoots(tx *gorm.DB, a *access, id string) ([]IntelligenceRoot, error) {
	if e := authorizeHistoricalSources(tx, a, id); e != nil {
		return nil, e
	}
	var rows []ReportSnapshotSource
	if e := tx.Where("snapshot_id=? AND company_id=?", id, a.Company.ID).Order("task_id,role").Limit(1001).Find(&rows).Error; e != nil {
		return nil, e
	}
	if len(rows) > 1000 {
		return nil, intelligenceError(422, "source_too_large")
	}
	out := []IntelligenceRoot{}
	for _, r := range rows {
		out = append(out, IntelligenceRoot{Kind: "task", ID: r.TaskID, Hash: r.Role})
	}
	return out, nil
}
func (s *Server) authorizeIntelligenceSources(tx *gorm.DB, a *access, m SourceManifest, mode SourceCheckMode) error {
	ids := map[string]bool{}
	for _, old := range m.Sources {
		if old.Request.ConversationID != "" {
			ids[old.Request.ConversationID] = true
		}
		for _, root := range old.Roots {
			if root.Evidence != nil && root.Evidence.Kind == "message" {
				ids[root.Evidence.ParentID] = true
			}
		}
		if old.Request.Kind == "transcript" {
			var sources []IntelligenceSource
			if e := tx.Where("job_id=? AND company_id=?", old.Request.ID, a.Company.ID).Find(&sources).Error; e != nil {
				return e
			}
			for _, source := range sources {
				if source.Binding.Request.ConversationID != "" {
					ids[source.Binding.Request.ConversationID] = true
				}
			}
		}
	}
	ordered := []string{}
	for id := range ids {
		ordered = append(ordered, id)
	}
	sort.Strings(ordered)
	for _, id := range ordered {
		var c Conversation
		if e := lockCommunicationRow(tx, "UPDATE").First(&c, "id=? AND company_id=?", id, a.Company.ID).Error; e != nil {
			return missing()
		}
	}

	for _, old := range m.Sources {
		if old.CompanyID != a.Company.ID {
			return missing()
		}
		current, e := s.captureIntelligenceSource(tx, a, old.Request)
		if e != nil {
			return intelligenceError(403, "source_unavailable")
		}
		if old.MemberEpoch != current.MemberEpoch || old.HistoryFromSequence != current.HistoryFromSequence {
			return intelligenceError(403, "source_unavailable")
		}
		if mode == IntelligenceExactCurrent && (old.ContentHash != current.ContentHash || old.PolicyVersion != current.PolicyVersion) {
			return intelligenceError(409, "source_changed")
		}
		if !current.ExpiresAt.IsZero() && !current.ExpiresAt.After(time.Now()) {
			return intelligenceError(410, "source_unavailable")
		}
	}
	return nil
}
func intelligencePublicSources(m SourceManifest) []map[string]any {
	out := []map[string]any{}
	for _, b := range m.Sources {
		out = append(out, map[string]any{"sourceKey": b.SourceKey, "kind": b.Request.Kind, "id": b.Request.ID, "parentId": b.Request.ParentID, "conversationId": b.Request.ConversationID, "selectedFieldSet": b.Request.SelectedFieldSet, "label": b.Label, "revision": b.Revision, "version": b.Version, "contentHash": b.ContentHash})
	}
	return out
}
func (s *Server) intelligenceSelectionPreview(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input IntelligenceSelection
	if e = decode(w, r, &input); e != nil {
		return e
	}
	var manifest SourceManifest
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var err error
		manifest, err = s.captureIntelligenceSources(tx, a, input)
		return err
	})
	if e != nil {
		return e
	}
	w.Header().Set("Cache-Control", "no-store")
	return respond(w, 200, map[string]any{"selectionHash": manifest.SourceSetHash, "sources": intelligencePublicSources(manifest), "expiresAt": manifest.ExpiresAt, "policyVersion": intelligencePolicy, "notice": "Only the selected sources are processed locally. Review generated content and citations before use."})
}
