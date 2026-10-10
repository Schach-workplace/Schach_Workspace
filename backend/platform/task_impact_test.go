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
