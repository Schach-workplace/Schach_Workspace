package platform

import (
	"encoding/json"
	"gorm.io/gorm"
	"net/http"
	"strconv"
	"time"
)

func (s *Server) intelligenceCapabilities(w http.ResponseWriter, r *http.Request) error {
	w.Header().Set("Cache-Control", "no-store")
	if _, e := s.access(r); e != nil {
		return e
	}
	ops := map[string]bool{}
	for _, op := range []IntelligenceOperation{"transcript", "summary", "action_draft", "report_explanation"} {
		ops[string(op)] = s.intelligenceAvailable(op)
	}
	w.Header().Set("Cache-Control", "no-store")
	out := map[string]any{"operations": ops, "policyVersion": intelligencePolicy, "notice": "Only explicitly selected authorized sources are processed by configured local models. Generated content can be wrong; review its sources.", "limits": map[string]int{"selectedSources": 50, "expandedSources": 1000, "textBytes": 65536, "textScalars": 20000, "audioBytes": 25 << 20, "audioSeconds": 600}}
	if s.opts.Intelligence == nil || s.opts.Intelligence.DisabledReason != "" {
		out["reasonCode"] = "provider_unavailable"
	} else {
		out["provider"] = s.opts.Intelligence.Identity
	}
	return respond(w, 200, out)
}
func (s *Server) intelligenceRead(w http.ResponseWriter, r *http.Request) error {
	w.Header().Set("Cache-Control", "no-store")
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var out IntelligenceJobView
	var deniedRead error
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var job IntelligenceJob
		if e := tx.Omit("result_json").First(&job, "id=? AND company_id=? AND actor_id=?", r.PathValue("id"), a.Company.ID, a.User.ID).Error; e != nil {
			return missing()
		}
		out = IntelligenceJobView{Operation: job.Operation, JobID: job.ID, State: job.State, ReasonCode: job.ReasonCode, ExpiresAt: job.ExpiresAt}
		if inString(job.State, "cancelled", "invalidated", "expired", "failed") {
			return nil
		}
		fail := func(state, code string) error {
			deniedRead = intelligenceError(403, code)
			return retireIntelligenceJob(tx, job.ID, state, code)
		}
		if !job.ExpiresAt.After(time.Now()) {
			return fail("expired", "expired")
		}
		if e := intelligenceOriginalAuthority(tx, a, job); e != nil {
			return fail("invalidated", "source_unavailable")
		}
		manifest, e := loadIntelligenceManifest(tx, job)
		if e != nil {
			return e
		}
		if e = s.authorizeIntelligenceSources(tx, a, manifest, IntelligenceExactCurrent); e != nil {
			return fail("invalidated", "source_unavailable")
		}
		// Recapture authorized display labels only; stored rows deliberately retain no prose.
		current, e := s.captureIntelligenceSources(tx, a, job.Selection)
		if e != nil {
			return fail("invalidated", "source_unavailable")
		}
		out.Sources = intelligencePublicSources(current)
		if job.Operation == "action_draft" && job.State == "ready" {
			flat, e := flattenIntelligenceManifest(tx, current)
			if e != nil {
				return e
			}
			out.Publication = intelligencePublicationView(tx, a, flat)
		}
		if job.State == "ready" {
			if e := tx.Select("result_json").First(&job, "id=?", job.ID).Error; e != nil {
				return e
			}
			out.Result = json.RawMessage(job.ResultJSON)
			out.ResultHash = job.ResultHash
			out.SourceSetHash = job.SourceSetHash
		}
		return nil
	})
	if e != nil {
		return e
	}
	if deniedRead != nil {
		return deniedRead
	}
	w.Header().Set("Cache-Control", "no-store")
	return respond(w, 200, out)
}
func (s *Server) intelligenceList(w http.ResponseWriter, r *http.Request) error {
	w.Header().Set("Cache-Control", "no-store")
	a, e := s.access(r)
	if e != nil {
		return e
	}
	limit := 20
	if q := r.URL.Query().Get("limit"); q != "" {
		limit, e = strconv.Atoi(q)
		if e != nil || limit < 1 || limit > 50 {
			return invalid("Choose 1–50 jobs.")
		}
	}
	cursor := r.URL.Query().Get("cursor")
	if len(cursor) > 100 {
		return invalid("Invalid cursor.")
	}
	var rows []IntelligenceJob
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		q := tx.Select("id,operation,state,reason_code,expires_at").Where("company_id=? AND actor_id=?", a.Company.ID, a.User.ID)
		if cursor != "" {
			q = q.Where("id < ?", cursor)
		}
		return q.Order("id DESC").Limit(limit + 1).Find(&rows).Error
	})
	if e != nil {
		return e
	}
	next := ""
	if len(rows) > limit {
		rows = rows[:limit]
		next = rows[len(rows)-1].ID
	}
	out := []IntelligenceJobView{}
	for _, j := range rows {
		out = append(out, IntelligenceJobView{Operation: j.Operation, JobID: j.ID, State: j.State, ReasonCode: j.ReasonCode, ExpiresAt: j.ExpiresAt})
	}
	w.Header().Set("Cache-Control", "no-store")
	return respond(w, 200, map[string]any{"jobs": out, "cursor": next})
}
func (s *Server) intelligenceCancel(w http.ResponseWriter, r *http.Request) error {
	w.Header().Set("Cache-Control", "no-store")
	a, e := s.access(r)
	if e != nil {
		return e
	}
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var j IntelligenceJob
		if e := tx.Select("id").First(&j, "id=? AND company_id=? AND actor_id=?", r.PathValue("id"), a.Company.ID, a.User.ID).Error; e != nil {
			return missing()
		}
		return retireIntelligenceJob(tx, j.ID, "cancelled", "cancelled")
	})
	if e != nil {
		return e
	}
	w.Header().Set("Cache-Control", "no-store")
	return respond(w, 200, map[string]any{"jobId": r.PathValue("id"), "state": "cancelled"})
}
