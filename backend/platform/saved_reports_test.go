package platform

import "testing"

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
