package platform

import (
	"bufio"
	"context"
	"gorm.io/gorm/logger"
	"net"
	"net/http"
	"sync"
	"time"
)

// RequestMetric contains route templates only. Never add URL, IDs, SQL, text or
// error messages here: sinks may persist these low-cardinality measurements.
type RequestMetric struct {
	Endpoint      string
	Status        int
	Bytes         int64
	Duration      time.Duration
	QueryRows     int64
	Queries       int
	QueryDuration time.Duration
}
type queryMeasurement struct {
	mu       sync.Mutex
	rows     int64
	count    int
	duration time.Duration
}
type measurementKey struct{}
type measuredLogger struct{}

func (measuredLogger) LogMode(logger.LogLevel) logger.Interface { return measuredLogger{} }
func (measuredLogger) Info(context.Context, string, ...any)     {}
func (measuredLogger) Warn(context.Context, string, ...any)     {}
func (measuredLogger) Error(context.Context, string, ...any)    {}
func (measuredLogger) Trace(ctx context.Context, begin time.Time, result func() (string, int64), _ error) {
	if m, ok := ctx.Value(measurementKey{}).(*queryMeasurement); ok {
		m.mu.Lock()
		_, rows := result()
		if rows > 0 {
			m.rows += rows
		}
		m.count++
		m.duration += time.Since(begin)
		m.mu.Unlock()
	}
}

type measuredResponse struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (w *measuredResponse) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}
func (w *measuredResponse) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(200)
	}
	n, e := w.ResponseWriter.Write(b)
	w.bytes += int64(n)
	return n, e
}
func (w *measuredResponse) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *measuredResponse) Flush() {
	if w.status == 0 {
		w.WriteHeader(200)
	}
	_ = http.NewResponseController(w.ResponseWriter).Flush()
}
func (w *measuredResponse) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	c, b, e := http.NewResponseController(w.ResponseWriter).Hijack()
	if e == nil {
		w.status = 101
	}
	return c, b, e
}
