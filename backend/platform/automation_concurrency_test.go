package platform

import (
	"sync"
	"testing"
	"time"
)

func TestConcurrentAutomationClaims(t *testing.T) {
	s, db := testServer(t)
	c := login(t, s, "founder@example.com")
	cid := firstCompany(t, s, c)
	b := taskBody(me(t, s, c))
	b["startDate"] = ""
	b["dueDate"] = time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	b["recurrence"] = "daily"
	id := createTask(t, s, c, cid, b)
	st, _, _ := req(t, s, "PATCH", "/api/companies/"+cid+"/tasks/"+id, map[string]any{"version": 1, "status": "done"}, c)
	if st != 200 {
		t.Fatal(st)
	}
	start := make(chan struct{})
	var wg sync.WaitGroup
	results := make(chan [2]int, 4)
	errors := make(chan error, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			n, r, e := s.RunAutomations(t.Context())
			results <- [2]int{n, r}
			errors <- e
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	close(errors)
	for e := range errors {
		if e != nil {
			t.Fatal(e)
		}
	}
	n, r := 0, 0
	for v := range results {
		n += v[0]
		r += v[1]
	}
	if n != 1 || r != 1 {
		t.Fatalf("claims %d %d", n, r)
	}
	var count int64
	if e := db.Model(&Task{}).Count(&count).Error; e != nil || count != 2 {
		t.Fatalf("tasks %d %v", count, e)
	}
	n, r, e := s.RunAutomations(t.Context())
	if e != nil || n != 0 || r != 0 {
		t.Fatalf("replay %d %d %v", n, r, e)
	}
}
