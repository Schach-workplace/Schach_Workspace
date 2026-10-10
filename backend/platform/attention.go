package platform

import (
	"errors"
	"gorm.io/gorm"
	"net/http"
	"time"
)

func (s *Server) attentionRoutes() {
	s.route("GET /api/companies/{cid}/communication/requests/{request}", s.getPublishedIntake)
	s.route("GET /api/companies/{cid}/conversations/{id}/records/{record}", s.getAttentionRecord)
	s.route("GET /api/companies/{cid}/attention", s.listAttention)
	s.route("GET /api/companies/{cid}/attention/preferences", s.getAttentionPreferences)
	s.route("PATCH /api/companies/{cid}/attention/preferences", s.patchAttentionPreferences)
	s.route("GET /api/companies/{cid}/attention/{item}", s.getAttention)
	s.route("POST /api/companies/{cid}/attention/{item}/transition", s.transitionAttention)
}
func attentionMissing(e error) bool {
	var a *apiError
	return errors.As(e, &a) && a.Status == 404 || errors.Is(e, gorm.ErrRecordNotFound)
}
func (s *Server) listAttention(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	limit, e := pageLimit(r)
	if e != nil {
		return e
	}
	state := r.URL.Query().Get("state")
	if state == "" {
		state = "open"
	}
	if !in(state, "open", "resolved", "all") {
		return invalid("Unknown attention state.")
	}
	decision := r.URL.Query().Get("decisionsOnly")
	if !in(decision, "", "false", "true") {
		return invalid("Invalid decisions filter.")
	}
	sourceKind, sourceID, kind := r.URL.Query().Get("sourceKind"), r.URL.Query().Get("sourceId"), r.URL.Query().Get("kind")
	if sourceKind != "" || sourceID != "" || kind != "" {
		if sourceKind != "task" || sourceID == "" || len(sourceID) > 100 || kind != "blocker" || state != "open" || decision == "true" {
			return invalid("Source lookup requires sourceKind=task, sourceId and kind=blocker for open items.")
		}
	}
	views := []AttentionView{}
	cursor := ""
	more := false
	basis := ""
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var err error
		a, err = currentAttentionActorLocked(tx, a.Company.ID, a.User.ID)
		if err != nil {
			return err
		}
		basis = payloadHash([]string{accessBasis(a), "attention", state, decision, sourceKind, sourceID, kind})
		last := readCursor{Basis: basis}
		if raw := r.URL.Query().Get("cursor"); raw != "" {
			last, err = decodeReadCursor(raw, basis)
			if err != nil {
				return err
			}
		}
		// Scan bounded identifier batches, continuing past revoked candidates; LIMIT
		// applies to authorized projections, never to an initial unscoped output page.
		for {
			q := attentionCandidates(tx, a).Where("state <> ?", "superseded")
			if sourceKind != "" {
				if _, err := scopedTask(tx, a, sourceID); err != nil {
					return err
				}
				q = q.Where("source_kind = ? AND source_id = ? AND kind = ?", sourceKind, sourceID, kind)
			}
			if decision != "true" && state != "all" {
				q = q.Where("state=?", state)
			}
			if last.ID != "" {
				instant, parseErr := time.Parse(time.RFC3339Nano, last.Created)
				if parseErr != nil {
					return invalid("Invalid attention cursor.")
				}
				q = q.Where("created_at < ? OR (created_at = ? AND id < ?)", instant, instant, last.ID)
			}
			var rows []AttentionItem
			if err = q.Order("created_at DESC,id DESC").Limit(100).Find(&rows).Error; err != nil {
				return err
			}
			for _, item := range rows {
				v, err := attentionSource(tx, a, item)
				if err != nil {
					if attentionMissing(err) {
						continue
					}
					return err
				}
				if decision == "true" && !v.CanDecide {
					continue
				}
				if len(views) == limit {
					more = true
					return nil
				}
				views = append(views, v)
				cursor = encodeReadCursor(readCursor{Basis: basis, Created: item.CreatedAt.Format(time.RFC3339Nano), ID: item.ID})
			}
			if len(rows) < 100 {
				return nil
			}
			item := rows[len(rows)-1]
			last = readCursor{Basis: basis, Created: item.CreatedAt.Format(time.RFC3339Nano), ID: item.ID}
		}
	})
	if e != nil {
		return e
	}
	if !more {
		cursor = ""
	}
	return respond(w, 200, map[string]any{"items": views, "cursor": cursor, "hasMore": more, "readBasis": accessBasis(a)})
}
func (s *Server) getAttention(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var view AttentionView
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var err error
		a, err = currentAttentionActorLocked(tx, a.Company.ID, a.User.ID)
		if err != nil {
			return err
		}
		var item AttentionItem
		if err = tx.First(&item, "company_id=? AND recipient_id=? AND id=?", a.Company.ID, a.User.ID, r.PathValue("item")).Error; err != nil {
			return missing()
		}
		view, err = attentionSource(tx, a, item)
		if err != nil {
			return err
		}
		if view.CanRoute {
			for uid, m := range a.Members {
				if uid != a.User.ID && m.Active && !a.Users[uid].Suspended && attentionCanRoute(tx, a, item, uid) == nil {
					view.RoutePeople = append(view.RoutePeople, person(a.Users[uid], m))
				}
			}
			view.CanRoute = len(view.RoutePeople) > 0
		}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"item": view, "readBasis": accessBasis(a)})
}

// Remaining endpoints are supplied by transition and scheduling modules.
