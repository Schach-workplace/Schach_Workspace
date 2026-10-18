package platform

import (
	"encoding/json"
	"fmt"
	"gorm.io/gorm"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

func (s *Server) knowledgeRoutes() {
	b := "/api/companies/{cid}/knowledge"
	s.route("GET "+b, s.knowledgeList)
	s.route("GET "+b+"/{id}", s.knowledgeDetail)
	s.route("POST "+b, s.knowledgeSave)
	s.route("PATCH "+b+"/{id}", s.knowledgeSave)
	s.route("POST "+b+"/{id}/review", s.knowledgeReview)
	s.route("POST "+b+"/answers", s.knowledgeAnswer)
}
func knowledgeCurrent(a *access, p KnowledgeArticle) bool {
	return a.activeUser(p.OwnerID) && a.activeUser(p.ReviewerID) && a.Members[p.ReviewerID].Role != "viewer" && p.ReviewerID != p.OwnerID
}
func knowledgePublished(a *access, p KnowledgeArticle) bool {
	return knowledgeCurrent(a, p) && p.State == "published" && p.ReviewedVersion == p.Version && p.ReviewDueDate >= knowledgeCivilDate(a.Company.Timezone, time.Now())
}
func knowledgeReadable(a *access, p KnowledgeArticle) bool {
	if a.Member.Role != "viewer" && (a.User.ID == p.OwnerID || a.User.ID == p.ReviewerID) {
		return true
	}
	if !knowledgePublished(a, p) {
		return false
	}
	return p.Audience == "company" || in(a.User.ID, p.ReaderIDs...)
}
func scopedKnowledge(tx *gorm.DB, a *access, id string) (KnowledgeArticle, error) {
	var p KnowledgeArticle
	e := tx.Where("company_id=? AND id=?", a.Company.ID, id).First(&p).Error
	if e == gorm.ErrRecordNotFound {
		return p, missing()
	}
	if e != nil {
		return p, e
	}
	if !knowledgeReadable(a, p) {
		return p, missing()
	}
	return p, nil
}
func knowledgeAuthority(a *access, p KnowledgeArticle, review bool) error {
	if a.Member.Role == "viewer" {
		return denied()
	}
	if review {
		if p.ReviewerID != a.User.ID || p.OwnerID == a.User.ID {
			return denied()
		}
	} else if p.OwnerID != a.User.ID {
		return denied()
	}
	return nil
}
func validateKnowledge(a *access, p KnowledgeArticle) error {
	if !clean(p.Title, 160) || !clean(p.Body, 16000) || !in(p.Pilot, "engineering", "office", "field", "all") || !in(p.Audience, "company", "selected") || !in(p.State, "draft", "archived") || len(p.ReaderIDs) > 100 {
		return invalid("Supply bounded guidance, a pilot, audience and draft or archived state.")
	}
	d, e := time.Parse("2006-01-02", p.ReviewDueDate)
	if e != nil || d.Format("2006-01-02") != p.ReviewDueDate {
		return invalid("Supply a real ISO review date.")
	}
	if !knowledgeCurrent(a, p) {
		return invalid("Choose an active independent nonviewer reviewer.")
	}
	seen := map[string]bool{}
	for _, id := range p.ReaderIDs {
		if seen[id] || !a.activeUser(id) {
			return invalid("Choose distinct active company readers.")
		}
		seen[id] = true
	}
	return nil
}
func knowledgeEpoch(tx *gorm.DB, a *access) error {
	res := tx.Model(&Company{}).Where("id=? AND permission_epoch=?", a.Company.ID, a.Company.PermissionEpoch).Update("permission_epoch", a.Company.PermissionEpoch+1)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected != 1 {
		return conflict()
	}
	a.Company.PermissionEpoch++
	return nil
}
func (s *Server) knowledgeList(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	limit, e := planningLimit(r)
	if e != nil {
		return e
	}
	query := strings.ToLower(r.URL.Query().Get("query"))
	pilot := r.URL.Query().Get("pilot")
	if len(query) > 160 || pilot != "" && !in(pilot, "engineering", "office", "field", "all") {
		return invalid("Invalid search or pilot.")
	}
	rows := []KnowledgeArticle{}
	cursor := ""
	more := false
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		all := []KnowledgeArticle{}
		if e := tx.Where("company_id=?", a.Company.ID).Order("id").Find(&all).Error; e != nil {
			return e
		}
		visible := []KnowledgeArticle{}
		for _, p := range all {
			if p.State != "archived" && knowledgeReadable(a, p) && !(p.State == "published" && !knowledgePublished(a, p)) && (pilot == "" || pilot == "all" || p.Pilot == pilot || p.Pilot == "all") && strings.Contains(strings.ToLower(p.Title+"\n"+p.Body), query) {
				visible = append(visible, p)
			}
		}
		basis := payloadHash([]any{accessBasis(a), query, pilot, visible})
		c := readCursor{}
		if raw := r.URL.Query().Get("cursor"); raw != "" {
			var err error
			c, err = decodeReadCursor(raw, basis)
			if err != nil {
				return err
			}
		}
		for _, p := range visible {
			if p.ID > c.ID {
				rows = append(rows, p)
			}
		}
		if len(rows) > limit {
			more = true
			rows = rows[:limit]
			cursor = encodeReadCursor(readCursor{Basis: basis, ID: rows[len(rows)-1].ID})
		}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"articles": rows, "hasMore": more, "cursor": cursor})
}
func (s *Server) knowledgeDetail(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	out := map[string]any{}
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		p, e := scopedKnowledge(tx, a, r.PathValue("id"))
		if e != nil {
			return e
		}
		reviews := []KnowledgeReview{}
		if a.User.ID == p.OwnerID || a.User.ID == p.ReviewerID {
			if e = tx.Where("company_id=? AND article_id=?", a.Company.ID, p.ID).Order("created_at,id").Find(&reviews).Error; e != nil {
				return e
			}
		}
		out = map[string]any{"article": p, "reviews": reviews, "canEdit": knowledgeAuthority(a, p, false) == nil, "canReview": knowledgeAuthority(a, p, true) == nil && p.State != "archived"}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, out)
}
func knowledgeResult(tx *gorm.DB, a *access, v BusinessResult, review bool) error {
	if len(v.IDs) == 0 {
		return missing()
	}
	p, e := scopedKnowledge(tx, a, v.IDs[0])
	if e != nil {
		return e
	}
	return knowledgeAuthority(a, p, review)
}
func (s *Server) knowledgeSave(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	f, e := readFields(w, r, "retryKey", "expectedVersion", "pilot", "title", "body", "reviewerId", "audience", "readerIds", "state", "reviewDueDate")
	if e != nil {
		return e
	}
	key, e := optionalBusinessKey(f)
	if e != nil {
		return e
	}
	var version int64
	if raw, ok := f["expectedVersion"]; ok {
		if json.Unmarshal(raw, &version) != nil {
			return invalid("Invalid version.")
		}
	}
	update := r.Method == "PATCH"
	if update && version < 1 {
		return invalid("Supply expectedVersion.")
	}
	if !update {
		if _, ok := f["expectedVersion"]; ok {
			return invalid("New guidance has no version.")
		}
	}
	fields := map[string]json.RawMessage{}
	for k, v := range f {
		if k != "retryKey" && k != "expectedVersion" {
			if string(v) == "null" {
				return invalid("Fields cannot be null.")
			}
			fields[k] = v
		}
	}
	id := r.PathValue("id")
	var result BusinessResult
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var old, p KnowledgeArticle
		authorize := func() error {
			if a.Member.Role == "viewer" {
				return denied()
			}
			p = KnowledgeArticle{CompanyID: a.Company.ID, OwnerID: a.User.ID, Version: 1, KnowledgeFields: KnowledgeFields{State: "draft", ReaderIDs: []string{}}}
			if update {
				var e error
				old, e = scopedKnowledge(tx, a, id)
				if e != nil {
					return e
				}
				if e = knowledgeAuthority(a, old, false); e != nil {
					return e
				}
				p = old
				p.ReaderIDs = append([]string{}, old.ReaderIDs...)
			}
			b, _ := json.Marshal(fields)
			if json.Unmarshal(b, &p) != nil {
				return invalid("Invalid guidance fields.")
			}
			if _, ok := fields["state"]; !ok {
				p.State = "draft"
			}
			return nil
		}
		op := "knowledge_create"
		if update {
			op = "knowledge_update"
		}
		var err error
		result, err = businessMutation(tx, a, op, key, []any{id, f}, authorize, func(v BusinessResult) error { return knowledgeResult(tx, a, v, false) }, func() (BusinessResult, error) {
			if e := validateKnowledge(a, p); e != nil {
				return BusinessResult{}, e
			}
			if update && old.Version != version {
				return BusinessResult{}, conflict()
			}
			p.ReviewedVersion = 0
			p.ReviewedBy = ""
			p.ReviewedAt = ""
			p.UpdatedAt = nowString()
			if update {
				p.Version++
				res := tx.Model(&KnowledgeArticle{}).Where("company_id=? AND id=? AND version=?", a.Company.ID, id, version).Select("*").Updates(&p)
				if res.Error != nil {
					return BusinessResult{}, res.Error
				}
				if res.RowsAffected != 1 {
					return BusinessResult{}, conflict()
				}
			} else {
				p.ID = newID("knowledge")
				p.CreatedAt = p.UpdatedAt
				if e := tx.Create(&p).Error; e != nil {
					return BusinessResult{}, e
				}
			}
			if e := knowledgeEpoch(tx, a); e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: op, IDs: []string{p.ID}, Versions: []int64{p.Version}}, nil
		})
		return err
	})
	if e != nil {
		return e
	}
	return respond(w, 200, developmentResponse(result))
}
func (s *Server) knowledgeReview(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input struct {
		RetryKey        string `json:"retryKey"`
		ExpectedVersion int64  `json:"expectedVersion"`
		Decision        string `json:"decision"`
		Reason          string `json:"reason"`
	}
	if e = decode(w, r, &input); e != nil {
		return e
	}
	if input.ExpectedVersion < 1 || !in(input.Decision, "publish", "return") || !clean(input.Reason, 2000) {
		return invalid("Supply version, publish or return decision and bounded reason.")
	}
	id := r.PathValue("id")
	var result BusinessResult
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		var p KnowledgeArticle
		authorize := func() error {
			var e error
			p, e = scopedKnowledge(tx, a, id)
			if e != nil {
				return e
			}
			return knowledgeAuthority(a, p, true)
		}
		var err error
		result, err = businessMutation(tx, a, "knowledge_review", input.RetryKey, []any{id, input}, authorize, func(v BusinessResult) error { return knowledgeResult(tx, a, v, true) }, func() (BusinessResult, error) {
			if p.Version != input.ExpectedVersion {
				return BusinessResult{}, conflict()
			}
			if p.State == "archived" || !knowledgeCurrent(a, p) {
				return BusinessResult{}, denied()
			}
			if input.Decision == "publish" && p.ReviewDueDate < knowledgeCivilDate(a.Company.Timezone, time.Now()) {
				return BusinessResult{}, invalid("Set a current review date before publishing.")
			}
			review := KnowledgeReview{ID: newID("knowledgereview"), CompanyID: a.Company.ID, ArticleID: id, ArticleVersion: p.Version, ReviewerID: a.User.ID, Decision: input.Decision, Reason: input.Reason, CreatedAt: nowString()}
			p.Version++
			p.State = "draft"
			p.ReviewedVersion = 0
			p.ReviewedBy = ""
			p.ReviewedAt = ""
			p.UpdatedAt = review.CreatedAt
			if input.Decision == "publish" {
				p.State = "published"
				p.ReviewedVersion = p.Version
				p.ReviewedBy = a.User.ID
				p.ReviewedAt = review.CreatedAt
			}
			res := tx.Model(&KnowledgeArticle{}).Where("company_id=? AND id=? AND version=?", a.Company.ID, id, input.ExpectedVersion).Select("*").Updates(&p)
			if res.Error != nil {
				return BusinessResult{}, res.Error
			}
			if res.RowsAffected != 1 {
				return BusinessResult{}, conflict()
			}
			if e := tx.Create(&review).Error; e != nil {
				return BusinessResult{}, e
			}
			if e := knowledgeEpoch(tx, a); e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "knowledge_review", IDs: []string{id, review.ID}, Versions: []int64{p.Version}}, nil
		})
		return err
	})
	if e != nil {
		return e
	}
	return respond(w, 200, developmentResponse(result))
}

type KnowledgeCitation struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Version int64  `json:"version"`
	Excerpt string `json:"excerpt"`
}

func (s *Server) knowledgeAnswer(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input struct {
		ArticleIDs []string `json:"articleIds"`
		Question   string   `json:"question"`
	}
	if e = decode(w, r, &input); e != nil {
		return e
	}
	if len(input.ArticleIDs) < 1 || len(input.ArticleIDs) > 8 || !clean(input.Question, 1000) {
		return invalid("Select 1–8 articles and a bounded question.")
	}
	citations := []KnowledgeCitation{}
	answer := []string{}
	reason := "No matching guidance in the selected sources."
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		sources := []KnowledgeArticle{}
		seen := map[string]bool{}
		for _, id := range input.ArticleIDs {
			if seen[id] {
				return invalid("Select distinct sources.")
			}
			seen[id] = true
			p, e := scopedKnowledge(tx, a, id)
			if e != nil {
				return e
			}
			if !knowledgePublished(a, p) {
				return missing()
			}
			sources = append(sources, p)
		}
		question := strings.ToLower(input.Question)
		for _, term := range []string{"approve", "approval", "personnel", "salary", "payment", "financial", "goal measurement", "rate employee"} {
			if strings.Contains(question, term) {
				reason = "This retrieval cannot make personnel, financial, task approval or goal measurement decisions."
				return nil
			}
		}
		words := strings.FieldsFunc(question, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
		for _, p := range sources {
			best := ""
			score := 0
			for _, paragraph := range strings.Split(p.Body, "\n") {
				n := 0
				for _, word := range words {
					if len(word) >= 3 && strings.Contains(strings.ToLower(paragraph), word) {
						n++
					}
				}
				if n > score {
					score = n
					best = paragraph
				}
			}
			if score > 0 {
				best = knowledgeExcerpt(best, words)
				citations = append(citations, KnowledgeCitation{p.ID, p.Title, p.Version, best})
				answer = append(answer, fmt.Sprintf("%s [%d]", best, len(citations)))
			}
		}
		return nil
	})
	if e != nil {
		return e
	}
	out := map[string]any{"answer": strings.Join(answer, "\n\n"), "citations": citations, "abstained": len(citations) == 0}
	if len(citations) == 0 {
		out["reason"] = reason
	}
	return respond(w, 200, out)
}

func knowledgeCivilDate(zone string, now time.Time) string {
	location, err := time.LoadLocation(zone)
	if err != nil {
		location = time.UTC
	}
	return now.In(location).Format("2006-01-02")
}

// Keep the evidence window around an actual ranked keyword rather than losing
// late matches by truncating the paragraph prefix. Rune offsets preserve UTF-8.
func knowledgeExcerpt(paragraph string, words []string) string {
	const bound = 800
	runes := []rune(paragraph)
	if len(runes) <= bound {
		return paragraph
	}
	lowered := strings.ToLower(paragraph)
	match, width := len(runes), 0
	for _, word := range words {
		if len(word) < 3 {
			continue
		}
		if offset := strings.Index(lowered, word); offset >= 0 {
			position := utf8.RuneCountInString(lowered[:offset])
			if position < match {
				match = position
				width = utf8.RuneCountInString(word)
			}
		}
	}
	start := match - (bound-min(width, bound))/2
	if start < 0 {
		start = 0
	}
	if start > len(runes)-bound {
		start = len(runes) - bound
	}
	return string(runes[start : start+bound])
}
