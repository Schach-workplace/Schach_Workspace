package platform

import (
	"strings"
	"testing"
)

func savedConfig(uid string) map[string]any {
	return map[string]any{"name": "Monthly delivery", "basis": "task_history_v1", "filters": map[string]any{}, "periodRule": "fixed", "from": "2026-09-01", "to": "2026-09-30", "timezonePolicy": "explicit", "reportZone": "Asia/Kolkata", "recipientIds": []string{uid}}
}
func TestSavedReportDefinitionVersions(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	path := "/api/companies/" + cid + "/reports/definitions"
	input := map[string]any{"retryKey": "save-definition", "configuration": savedConfig(uid)}
	st, b, w := req(t, s, "POST", path, input, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	id := b["definition"].(map[string]any)["id"].(string)
	st, b, w = req(t, s, "POST", path, input, c)
	if st != 200 || b["definition"].(map[string]any)["id"] != id {
		t.Fatal("lost ACK duplicate", w.Body.String())
	}
	cfg := savedConfig(uid)
	cfg["name"] = "Different"
	input["configuration"] = cfg
	st, _, _ = req(t, s, "POST", path, input, c)
	if st != 409 {
		t.Fatal("changed identity", st)
	}
	patch := map[string]any{"retryKey": "edit", "expectedVersion": 1, "configuration": cfg, "state": "active"}
	st, _, w = req(t, s, "PATCH", path+"/"+id, patch, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	patch["retryKey"] = "stale"
	st, _, _ = req(t, s, "PATCH", path+"/"+id, patch, c)
	if st != 409 {
		t.Fatal("stale accepted", st)
	}
	var revisions int64
	if e := db.Table("saved_report_revisions").Where("definition_id=?", id).Count(&revisions).Error; e != nil {
		t.Fatal(e)
	}
	if revisions != 2 {
		t.Fatal(revisions)
	}
}
func TestSavedReportPeriodResolution(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	path := "/api/companies/" + cid + "/reports/definitions"
	cfg := savedConfig(uid)
	cfg["periodRule"] = "previous_week"
	cfg["from"] = ""
	cfg["to"] = ""
	st, b, w := req(t, s, "POST", path, map[string]any{"retryKey": "week-definition", "configuration": cfg}, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	id := b["definition"].(map[string]any)["id"].(string)
	input := map[string]any{"retryKey": "generate-week", "expectedVersion": 1}
	st, b, w = req(t, s, "POST", path+"/"+id+"/generate", input, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	sid := b["snapshotId"]
	st, b, w = req(t, s, "POST", path+"/"+id+"/generate", input, c)
	if st != 200 || b["snapshotId"] != sid {
		t.Fatal("period replay regenerated", w.Body.String())
	}
}
func TestSavedReportInvalidation(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	path := "/api/companies/" + cid + "/reports/definitions"
	st, b, w := req(t, s, "POST", path, map[string]any{"retryKey": "pause-definition", "configuration": savedConfig(uid)}, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	id := b["definition"].(map[string]any)["id"].(string)
	st, _, w = req(t, s, "PATCH", path+"/"+id, map[string]any{"retryKey": "pause", "expectedVersion": 1, "configuration": savedConfig(uid), "state": "paused"}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	st, _, _ = req(t, s, "POST", path+"/"+id+"/generate", map[string]any{"retryKey": "paused-generate", "expectedVersion": 2}, c)
	if st != 409 {
		t.Fatal("paused generation accepted", st)
	}
}

func TestSavedReportOrphanManagementIsMetadataOnly(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	owner := addPerson(t, s, c, cid, "orphan-owner@example.com", "member")
	mc := login(t, s, "orphan-owner@example.com")
	root := "/api/companies/" + cid + "/reports/definitions"
	st, b, w := req(t, s, "POST", root, map[string]any{"retryKey": "orphan-create", "configuration": savedConfig(owner)}, mc)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	id := b["definition"].(map[string]any)["id"].(string)
	st, _, _ = req(t, s, "PATCH", root+"/"+id+"/orphan-state", map[string]any{"retryKey": "healthy", "expectedVersion": 1, "state": "paused"}, c)
	if st != 404 {
		t.Fatal("healthy definition exposed", st)
	}
	if e := db.Model(&Membership{}).Where("company_id=? AND user_id=?", cid, owner).Update("active", false).Error; e != nil {
		t.Fatal(e)
	}
	st, b, w = req(t, s, "GET", root+"/orphans", nil, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "configuration") || strings.Contains(w.Body.String(), "Monthly delivery") || strings.Contains(w.Body.String(), "recipientIds") {
		t.Fatal("orphan contents disclosed", b)
	}
	patch := map[string]any{"retryKey": "orphan-pause", "expectedVersion": 1, "state": "paused"}
	for i := 0; i < 2; i++ {
		st, b, w = req(t, s, "PATCH", root+"/"+id+"/orphan-state", patch, c)
		if st != 200 || b["version"] != float64(2) {
			t.Fatal(st, w.Body.String())
		}
	}
	st, _, _ = req(t, s, "GET", root+"/"+id, nil, c)
	if st != 404 {
		t.Fatal("leadership gained contents", st)
	}
	st, _, w = req(t, s, "PATCH", root+"/"+id+"/orphan-state", map[string]any{"retryKey": "orphan-delete", "expectedVersion": 2, "state": "deleted"}, c)
	if st != 200 {
		t.Fatal(st, w.Body.String())
	}
	var d SavedReportDefinition
	db.First(&d, "id=?", id)
	if d.State != "deleted" || d.OwnerID != owner || d.Version != 3 {
		t.Fatal(d)
	}
}

func TestSavedReplayReturnsCommittedRevisionAfterInterveningEdit(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	uid := me(t, s, c)
	root := "/api/companies/" + cid + "/reports/definitions"
	create := map[string]any{"retryKey": "canonical-create", "configuration": savedConfig(uid)}
	st, b, w := req(t, s, "POST", root, create, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	id := b["definition"].(map[string]any)["id"].(string)
	cfg := savedConfig(uid)
	cfg["name"] = "Committed second revision"
	edit := map[string]any{"retryKey": "canonical-edit", "expectedVersion": 1, "configuration": cfg, "state": "active"}
	st, _, w = req(t, s, "PATCH", root+"/"+id, edit, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	third := savedConfig(uid)
	third["name"] = "Unseen third revision"
	st, _, w = req(t, s, "PATCH", root+"/"+id, map[string]any{"retryKey": "intervening-edit", "expectedVersion": 2, "configuration": third, "state": "active"}, c)
	if st != 200 {
		t.Fatal(w.Body.String())
	}
	for _, replay := range []struct {
		method, path string
		body         map[string]any
		version      float64
		name         string
	}{{"POST", root, create, 1, "Monthly delivery"}, {"PATCH", root + "/" + id, edit, 2, "Committed second revision"}} {
		st, b, w = req(t, s, replay.method, replay.path, replay.body, c)
		if st != 200 {
			t.Fatal(w.Body.String())
		}
		d := b["definition"].(map[string]any)
		if d["version"] != replay.version || d["configuration"].(map[string]any)["name"] != replay.name {
			t.Fatal("retry silently rebased onto unseen row", d)
		}
	}
}
