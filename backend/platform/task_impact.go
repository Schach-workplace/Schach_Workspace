package platform

import (
	"gorm.io/gorm"
	"net/http"
	"sort"
)

type TaskCommitment struct {
	StartDate    string          `json:"startDate,omitempty"`
	DueDate      string          `json:"dueDate"`
	DeadlineMode string          `json:"deadlineMode"`
	DueAt        DeadlineInstant `json:"dueAt"`
	DueTimezone  string          `json:"dueTimezone"`
}

func currentCommitment(t Task) TaskCommitment {
	return TaskCommitment{StartDate: t.StartDate, DueDate: t.DueDate, DeadlineMode: t.DeadlineMode, DueAt: t.DueAt, DueTimezone: t.DueTimezone}
}
func originalCommitment(t Task) TaskCommitment {
	return TaskCommitment{DueDate: t.OriginalDueDate, DeadlineMode: t.OriginalDeadlineMode, DueAt: t.OriginalDueAt, DueTimezone: t.OriginalDueTimezone}
}

type TaskImpactNode struct {
	ID                 string         `json:"id"`
	Code               string         `json:"code"`
	Title              string         `json:"title"`
	OwnerID            string         `json:"ownerId"`
	Version            int64          `json:"version"`
	ProjectID          string         `json:"projectId"`
	CurrentCommitment  TaskCommitment `json:"currentCommitment"`
	OriginalCommitment TaskCommitment `json:"originalCommitment"`
	Status             string         `json:"status"`
}
type TaskImpactEdge struct {
	From string `json:"from"`
	To   string `json:"to"`
}

func visibleImpact(tx *gorm.DB, a *access, root Task) ([]TaskImpactNode, []TaskImpactEdge, error) {
	var tasks []Task
	if e := taskReadQuery(tx, a).Find(&tasks).Error; e != nil {
		return nil, nil, e
	}
	visible := map[string]Task{}
	upstream := map[string][]string{}
	downstream := map[string][]string{}
	for _, t := range tasks {
		visible[t.ID] = t
	}
	edges := []TaskImpactEdge{}
	for _, t := range tasks {
		for _, dep := range t.Dependencies {
			if _, ok := visible[dep]; ok {
				upstream[t.ID] = append(upstream[t.ID], dep)
				downstream[dep] = append(downstream[dep], t.ID)
				edges = append(edges, TaskImpactEdge{From: dep, To: t.ID})
			}
		}
	}
	seen := map[string]bool{root.ID: true}
	for _, direction := range []map[string][]string{upstream, downstream} {
		visited := map[string]bool{root.ID: true}
		pending := []string{root.ID}
		for len(pending) > 0 {
			id := pending[0]
			pending = pending[1:]
			for _, next := range direction[id] {
				if !visited[next] {
					visited[next] = true
					seen[next] = true
					pending = append(pending, next)
				}
			}
		}
	}
	nodes := []TaskImpactNode{}
	for id := range seen {
		t := visible[id]
		nodes = append(nodes, TaskImpactNode{ID: t.ID, Code: t.Code, Title: t.Title, OwnerID: t.OwnerID, Version: t.Version, ProjectID: t.ProjectID, CurrentCommitment: currentCommitment(t), OriginalCommitment: originalCommitment(t), Status: t.Status})
	}
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].ID < nodes[j].ID })
	filtered := []TaskImpactEdge{}
	for _, edge := range edges {
		if seen[edge.From] && seen[edge.To] {
			filtered = append(filtered, edge)
		}
	}
	sort.Slice(filtered, func(i, j int) bool {
		if filtered[i].From == filtered[j].From {
			return filtered[i].To < filtered[j].To
		}
		return filtered[i].From < filtered[j].From
	})
	return nodes, filtered, nil
}
func (s *Server) taskImpact(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	limit, e := pageLimit(r)
	if e != nil {
		return e
	}
	if r.URL.Query().Get("limit") == "" {
		limit = 50
	}
	var result map[string]any
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		root, e := scopedTask(tx, a, r.PathValue("id"))
		if e != nil {
			return e
		}
		nodes, edges, e := visibleImpact(tx, a, root)
		if e != nil {
			return e
		}
		basis := payloadHash([]any{accessBasis(a), "impact", root.ID, root.Version, nodes, edges})
		after := ""
		if cursor := r.URL.Query().Get("cursor"); cursor != "" {
			c, e := decodeReadCursor(cursor, basis)
			if e != nil {
				return e
			}
			after = c.ID
		}
		page := []TaskImpactNode{}
		for _, node := range nodes {
			if node.ID > after {
				page = append(page, node)
			}
			if len(page) > limit {
				break
			}
		}
		next := ""
		if len(page) > limit {
			page = page[:limit]
			next = encodeReadCursor(readCursor{Basis: basis, ID: page[len(page)-1].ID})
		}
		pageIDs := map[string]bool{}
		for _, node := range page {
			pageIDs[node.ID] = true
		}
		pageEdges := []TaskImpactEdge{}
		paths := [][]string{}
		for _, edge := range edges {
			if pageIDs[edge.From] {
				pageEdges = append(pageEdges, edge)
				paths = append(paths, []string{edge.From, edge.To})
			}
		}
		result = map[string]any{"rootId": root.ID, "nodes": page, "edges": pageEdges, "paths": paths, "notice": "Only authorized linked work is shown.", "nextCursor": next}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, result)
}
