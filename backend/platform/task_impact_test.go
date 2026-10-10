package platform

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestTaskImpactPrivacy(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	member := addPerson(t, s, c, cid, "impact-member@example.com", "member")
	other := addPerson(t, s, c, cid, "impact-other@example.com", "member")
	root := createTask(t, s, c, cid, taskBody(member))
	hidden := createTask(t, s, c, cid, taskBody(other))
	end := createTask(t, s, c, cid, taskBody(member))
	db.Model(&Task{}).Where("id = ?", root).Update("created_by", other)
	deps, _ := json.Marshal([]string{root})
	db.Model(&Task{}).Where("id = ?", hidden).Update("dependencies", string(deps))
	deps, _ = json.Marshal([]string{hidden})
	db.Model(&Task{}).Where("id = ?", end).Update("dependencies", string(deps))
	mc := login(t, s, "impact-member@example.com")
	st, b, w := req(t, s, "GET", "/api/companies/"+cid+"/tasks/"+root+"/impact", nil, mc)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	if strings.Contains(w.Body.String(), hidden) || strings.Contains(w.Body.String(), end) {
		t.Fatal("bridged hidden node", b)
	}
	st, _, _ = req(t, s, "GET", "/api/companies/"+cid+"/tasks/"+hidden+"/impact", nil, mc)
	if st != 404 {
		t.Fatal(st)
	}
}

func TestTaskImpactDirectedPaths(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	owner := me(t, s, c)
	upstream := createTask(t, s, c, cid, taskBody(owner))
	root := createTask(t, s, c, cid, taskBody(owner))
	downstream := createTask(t, s, c, cid, taskBody(owner))
	sibling := createTask(t, s, c, cid, taskBody(owner))
	for id, deps := range map[string][]string{root: {upstream}, downstream: {root}, sibling: {upstream}} {
		raw, _ := json.Marshal(deps)
		db.Model(&Task{}).Where("id = ?", id).Update("dependencies", string(raw))
	}
	st, _, w := req(t, s, "GET", "/api/companies/"+cid+"/tasks/"+root+"/impact", nil, c)
	if st != 200 || !strings.Contains(w.Body.String(), upstream) || !strings.Contains(w.Body.String(), downstream) || strings.Contains(w.Body.String(), sibling) {
		t.Fatal("root impact must follow directed ancestor/descendant paths", st, w.Body.String())
	}
}
