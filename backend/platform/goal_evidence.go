package platform

import (
	"database/sql"
	"fmt"
	"gorm.io/gorm"
	"net/http"
	"regexp"
	"sort"
	"time"
)

var goalHashPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

type goalEvidenceSource struct {
	input           GoalEvidenceInput
	label, excerpt  string
	epoch, sequence int64
	viewerEpochs    map[string]int64
}

func lockGoalEvidenceSources(tx *gorm.DB, a *access, input []GoalEvidenceInput) error {
	ids := []string{}
	seen := map[string]bool{}
	for _, i := range input {
		if i.Kind == "message" && !seen[i.ParentID] {
			seen[i.ParentID] = true
			ids = append(ids, i.ParentID)
		}
	}
	sort.Strings(ids)
	for _, id := range ids {
		var c Conversation
		if e := lockCommunicationRow(tx, "UPDATE").Where("id=? AND company_id=?", id, a.Company.ID).Find(&c).Error; e != nil {
			return e
		}
	}
	return nil
}
func loadGoalEvidenceSource(tx *gorm.DB, a *access, i GoalEvidenceInput) (goalEvidenceSource, error) {
	out := goalEvidenceSource{input: i}
	if i.SourceID == "" || len(i.SourceID) > 80 || len(i.ParentID) > 80 {
		return out, invalid("Choose a current evidence source.")
	}
	domain := []any{"goal_evidence_v1", a.Company.ID, i.Kind, i.ParentID, i.SourceID}
	switch i.Kind {
	case "task":
		t, e := scopedTask(tx, a, i.SourceID)
		if e != nil {
			return out, e
		}
		if i.ParentID != "" && i.ParentID != t.ID {
			return out, missing()
		}
		out.input.ParentID = ""
		out.input.Revision = t.Version
		out.label = t.Title
		domain = []any{"goal_evidence_v1", a.Company.ID, i.Kind, "", t.ID, t.Version, t.Title, t.Status, t.Progress, t.EstimatedHours, t.OwnerID, t.DepartmentID, t.ProjectID, t.StartDate, t.DueDate, t.DeadlineMode, t.DueAt, t.DueTimezone}
	case "task_comment":
		t, e := scopedTask(tx, a, i.ParentID)
		if e != nil {
			return out, e
		}
		var comment Comment
		if e := tx.First(&comment, "id=? AND task_id=? AND company_id=?", i.SourceID, t.ID, a.Company.ID).Error; e != nil {
			return out, missing()
		}
		out.input.Revision = 0
		out.label = "Comment on " + t.Title
		out.excerpt = comment.Body
		domain = append(domain, comment.UserID, comment.Body, comment.CreatedAt)
	case "message":
		scope, e := conversationAccess(tx, a.User.ID, a.Company.ID, i.ParentID)
		if e != nil {
			return out, e
		}
		message, e := scopedMessage(tx, scope, i.SourceID)
		if e != nil {
			return out, e
		}
		if message.Removed || message.ContentPurged {
			return out, missing()
		}
		out.input.Revision = message.Revision
		out.label = "Message in " + scope.Conversation.Title
		out.excerpt = message.Body
		out.epoch = scope.Epoch
		out.sequence = message.Sequence
		out.viewerEpochs = map[string]int64{}
		if !scope.Conversation.Public {
			var members []ConversationMember
			if e := tx.Where("company_id=? AND conversation_id=? AND active=? AND history_from_sequence<=?", a.Company.ID, i.ParentID, true, message.Sequence).Order("user_id").Find(&members).Error; e != nil {
				return out, e
			}
			for _, m := range members {
				out.viewerEpochs[m.UserID] = m.Epoch
			}
		}
		domain = append(domain, message.Revision, message.Body, message.Removed, message.SenderID, message.Sequence, message.CreatedAt, message.UpdatedAt, message.ReplyToID)
	case "report_snapshot":
		if i.ParentID != "" {
			return out, missing()
		}
		if e := authorizeHistoricalSources(tx, a, i.SourceID); e != nil {
			return out, e
		}
		var snap HistoricalReportSnapshot
		if e := tx.First(&snap, "id=? AND company_id=? AND requester_id=?", i.SourceID, a.Company.ID, a.User.ID).Error; e != nil {
			return out, missing()
		}
		var sources []ReportSnapshotSource
		if e := tx.Where("snapshot_id=? AND company_id=?", snap.ID, a.Company.ID).Order("task_id,role").Find(&sources).Error; e != nil {
			return out, e
		}
		out.input.Revision = int64(snap.SchemaVersion)
		out.label = fmt.Sprintf("Report %s – %s (%s)", snap.Period.From, snap.Period.To, snap.Basis)
		domain = append(domain, snap.SchemaVersion, snap.MetricVersion, snap.ContentHash, snap.Basis, sources)
	default:
		return out, invalid("Choose task, task_comment, message or report_snapshot evidence.")
	}
	out.input.ContentHash = payloadHash(domain)
	if len(out.excerpt) > 600 {
		out.excerpt = out.excerpt[:600]
	}
	return out, nil
}
func goalEvidenceAuthority(tx *gorm.DB, a *access, g Goal, input []GoalEvidenceInput) error {
	if len(input) > 50 {
		return invalid("Select at most 50 evidence sources.")
	}
	seen := map[string]bool{}
	for _, i := range input {
		key := i.Kind + ":" + i.ParentID + ":" + i.SourceID
		if seen[key] || !goalHashPattern.MatchString(i.ContentHash) {
			return invalid("Choose unique exact evidence bindings.")
		}
		seen[key] = true
	}
	if e := lockGoalEvidenceSources(tx, a, input); e != nil {
		return e
	}
	for _, i := range input {
		if _, e := loadGoalEvidenceSource(tx, a, i); e != nil {
			return e
		}
	}
	return nil
}
func bindGoalEvidence(tx *gorm.DB, a *access, g Goal, input []GoalEvidenceInput) ([]GoalEvidenceBinding, error) {
	if e := goalEvidenceAuthority(tx, a, g, input); e != nil {
		return nil, e
	}
	out := []GoalEvidenceBinding{}
	for _, i := range input {
		source, e := loadGoalEvidenceSource(tx, a, i)
		if e != nil {
			return nil, e
		}
		if source.input.ContentHash != i.ContentHash || source.input.Revision != i.Revision {
			return nil, conflict()
		}
		out = append(out, GoalEvidenceBinding{GoalEvidenceInput: source.input, HistoryEpoch: source.epoch, Sequence: source.sequence, ViewerEpochs: source.viewerEpochs})
	}
	return out, nil
}
func authorizeStoredGoalEvidence(tx *gorm.DB, a *access, b GoalEvidenceBinding) error {
	source, e := loadGoalEvidenceSource(tx, a, b.GoalEvidenceInput)
	if e != nil {
		return e
	}
	if b.Kind == "message" {
		if len(b.ViewerEpochs) > 0 {
			epoch, ok := b.ViewerEpochs[a.User.ID]
			if !ok || epoch != source.epoch {
				return missing()
			}
		}
		if source.sequence != b.Sequence {
			return missing()
		}
	}
	return nil
}
func projectGoalEvidence(tx *gorm.DB, a *access, b GoalEvidenceBinding) map[string]any {
	if e := authorizeStoredGoalEvidence(tx, a, b); e != nil {
		return map[string]any{"status": "evidence_unavailable"}
	}
	source, e := loadGoalEvidenceSource(tx, a, b.GoalEvidenceInput)
	if e != nil {
		return map[string]any{"status": "evidence_unavailable"}
	}
	out := map[string]any{"status": "matching", "kind": b.Kind, "sourceId": b.SourceID, "parentId": b.ParentID, "revision": b.Revision, "contentHash": b.ContentHash, "label": source.label}
	if source.input.ContentHash != b.ContentHash || source.input.Revision != b.Revision {
		out["status"] = "changed_since_measurement"
	} else {
		out["excerpt"] = source.excerpt
	}
	return out
}
func (s *Server) goalEvidencePreview(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	out := map[string]any{}
	e = s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error {
		g, e := scopedGoal(tx, a, r.PathValue("id"))
		if e != nil {
			return e
		}
		if e = measureAuthority(tx, a, g); e != nil {
			return e
		}
		i := GoalEvidenceInput{Kind: r.URL.Query().Get("kind"), SourceID: r.URL.Query().Get("sourceId"), ParentID: r.URL.Query().Get("parentId")}
		if e = lockGoalEvidenceSources(tx, a, []GoalEvidenceInput{i}); e != nil {
			return e
		}
		source, e := loadGoalEvidenceSource(tx, a, i)
		if e != nil {
			return e
		}
		out = map[string]any{"kind": source.input.Kind, "sourceId": source.input.SourceID, "parentId": source.input.ParentID, "revision": source.input.Revision, "contentHash": source.input.ContentHash, "label": source.label, "excerpt": source.excerpt, "audienceNotice": "Your authored reason is shared with the goal audience. Private evidence stays subject to its own current access."}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return e
	}
	return respond(w, 200, out)
}
func (s *Server) goalEvidenceOptions(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	limit, e := planningLimit(r)
	if e != nil {
		return e
	}
	kind := r.URL.Query().Get("kind")
	options := []map[string]any{}
	cursor := ""
	more := false
	e = s.withReportAccessTransaction(r, a, func(tx *gorm.DB) error {
		g, e := scopedGoal(tx, a, r.PathValue("id"))
		if e != nil {
			return e
		}
		if e = measureAuthority(tx, a, g); e != nil {
			return e
		}
		if kind == "message" {
			if e := lockGoalEvidenceSources(tx, a, []GoalEvidenceInput{{Kind: kind, ParentID: r.URL.Query().Get("parentId")}}); e != nil {
				return e
			}
		}
		basis := payloadHash([]any{a.User.ID, a.Company.ID, g.ID, accessBasis(a), kind, r.URL.Query().Get("parentId")})
		c := readCursor{}
		if r.URL.Query().Get("cursor") != "" {
			c, e = decodeReadCursor(r.URL.Query().Get("cursor"), basis)
			if e != nil {
				return e
			}
		}
		if kind != "report_snapshot" {
			return s.goalOtherEvidenceOptions(tx, a, r, kind, c, limit, basis, &options, &cursor, &more)
		}
		// ALL current manifest-source ACL is part of the candidate query before
		// cursor and LIMIT. A hidden first page cannot consume accessible slots.
		q := tx.Model(&HistoricalReportSnapshot{}).Where("company_id=? AND requester_id=?", a.Company.ID, a.User.ID).Where("NOT EXISTS (SELECT 1 FROM report_snapshot_sources source WHERE source.snapshot_id=historical_report_snapshots.id AND source.company_id=? AND source.task_id NOT IN (?))", a.Company.ID, taskReadQuery(tx, a).Select("id"))
		if c.ID != "" {
			at, e := time.Parse(time.RFC3339Nano, c.Created)
			if e != nil {
				return invalid("Invalid report evidence cursor.")
			}
			q = q.Where("generated_at<? OR (generated_at=? AND id>?)", at, at, c.ID)
		}
		var snaps []HistoricalReportSnapshot
		if e = q.Order("generated_at DESC,id").Limit(limit + 1).Find(&snaps).Error; e != nil {
			return e
		}
		more = len(snaps) > limit
		if more {
			snaps = snaps[:limit]
		}
		for _, snap := range snaps {
			if e := authorizeHistoricalSources(tx, a, snap.ID); e != nil {
				return e
			}
			options = append(options, map[string]any{"sourceId": snap.ID, "label": fmt.Sprintf("Report %s – %s (%s)", snap.Period.From, snap.Period.To, snap.Basis), "period": snap.Period, "generatedAt": snap.GeneratedAt, "schemaVersion": snap.SchemaVersion, "contentHash": snap.ContentHash})
		}
		if more {
			last := snaps[len(snaps)-1]
			cursor = encodeReadCursor(readCursor{Basis: basis, ID: last.ID, Created: last.GeneratedAt.UTC().Format(time.RFC3339Nano)})
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"options": options, "cursor": cursor, "hasMore": more})
}
func (s *Server) goalOtherEvidenceOptions(tx *gorm.DB, a *access, r *http.Request, kind string, c readCursor, limit int, basis string, options *[]map[string]any, cursor *string, more *bool) error {
	parent := r.URL.Query().Get("parentId")
	if kind == "task" {
		var tasks []Task
		q := taskReadQuery(tx, a)
		if c.ID != "" {
			q = q.Where("id>?", c.ID)
		}
		if e := q.Order("id").Limit(limit + 1).Find(&tasks).Error; e != nil {
			return e
		}
		*more = len(tasks) > limit
		if *more {
			tasks = tasks[:limit]
		}
		for _, t := range tasks {
			*options = append(*options, map[string]any{"sourceId": t.ID, "parentId": "", "label": t.Title})
		}
	} else if kind == "task_comment" {
		if _, e := scopedTask(tx, a, parent); e != nil {
			return e
		}
		var rows []Comment
		q := tx.Where("company_id=? AND task_id=?", a.Company.ID, parent)
		if c.ID != "" {
			q = q.Where("id>?", c.ID)
		}
		if e := q.Order("id").Limit(limit + 1).Find(&rows).Error; e != nil {
			return e
		}
		*more = len(rows) > limit
		if *more {
			rows = rows[:limit]
		}
		for _, row := range rows {
			label := row.Body
			if len(label) > 120 {
				label = label[:120]
			}
			*options = append(*options, map[string]any{"sourceId": row.ID, "parentId": parent, "label": label})
		}
	} else if kind == "message" {
		scope, e := conversationAccess(tx, a.User.ID, a.Company.ID, parent)
		if e != nil {
			return e
		}
		var rows []Message
		q := tx.Where("company_id=? AND conversation_id=? AND sequence>=? AND removed=? AND content_purged=?", a.Company.ID, parent, scope.HistoryFromSequence, false, false)
		if c.ID != "" {
			q = q.Where("id>?", c.ID)
		}
		if e = q.Order("id").Limit(limit + 1).Find(&rows).Error; e != nil {
			return e
		}
		*more = len(rows) > limit
		if *more {
			rows = rows[:limit]
		}
		for _, row := range rows {
			label := row.Body
			if len(label) > 120 {
				label = label[:120]
			}
			*options = append(*options, map[string]any{"sourceId": row.ID, "parentId": parent, "label": label, "revision": row.Revision})
		}
	} else {
		return invalid("Choose a supported evidence kind.")
	}
	if *more && len(*options) > 0 {
		*cursor = encodeReadCursor(readCursor{Basis: basis, ID: (*options)[len(*options)-1]["sourceId"].(string)})
	}
	return nil
}
