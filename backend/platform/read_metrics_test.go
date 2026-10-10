package platform

import (
	"strings"
	"testing"
)

func TestEndpointMetricsSanitizedAndCountQueries(t *testing.T) {
	s, _ := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	var got RequestMetric
	s.opts.MetricSink = func(m RequestMetric) { got = m }
	status, _, w := req(t, s, "GET", "/api/companies/"+cid+"/tasks?ownerId=private-text", nil, c)
	if status != 200 || got.Endpoint != "GET /api/companies/{cid}/tasks" || got.Status != 200 || got.Bytes != int64(w.Body.Len()) || got.Queries < 5 || got.QueryDuration <= 0 || got.Duration <= 0 {
		t.Fatal(got, status)
	}
	if strings.Contains(got.Endpoint, cid) || strings.Contains(got.Endpoint, "private-text") {
		t.Fatal("metric leaked input", got)
	}
}
func TestFinanceListBatchesWorkReferenceAuthorization(t *testing.T) {
	f := newFinanceFixture(t)
	task := createTask(t, f.s, f.cookie, f.cid, taskBody(f.uid))
	for i := 0; i < 5; i++ {
		id := f.addExpense(t, 100, f.cookie)
		f.db.Model(&Expense{}).Where("id=?", id).Update("task_id", task)
	}
	var metric RequestMetric
	f.s.opts.MetricSink = func(m RequestMetric) { metric = m }
	status, _, _ := req(t, f.s, "GET", f.base()+"/expenses", nil, f.cookie)
	if status != 200 || metric.Queries > 9 {
		t.Fatal(status, metric)
	}
}
