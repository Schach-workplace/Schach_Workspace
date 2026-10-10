// httpbridge exercises the real shared handler through JSON lines and httptest.
// It creates a disposable in-memory SQLite database and never listens on a port.
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"schach.local/workspace/backend/platform"
)

type requestLine struct {
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Body    []byte            `json:"body"`
	Headers map[string]string `json:"headers"`
}

type inputLine struct {
	requestLine
	Batch []requestLine `json:"batch,omitempty"`
}

type batchResponse struct {
	Responses []responseLine `json:"responses"`
}

type responseLine struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    []byte            `json:"body"`
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "HTTP bridge:", err)
		os.Exit(1)
	}
}

func run() error {
	db, err := gorm.Open(sqlite.Open("file:schach-httpbridge?mode=memory&cache=shared&_foreign_keys=on&_busy_timeout=5000"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		return fmt.Errorf("open disposable SQLite database: %w", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	defer sqlDB.Close()
	sqlDB.SetMaxOpenConns(1)
	if err = platform.Migrate(db); err != nil {
		return fmt.Errorf("migrate disposable database: %w", err)
	}
	if err = platform.SeedDemo(db); err != nil {
		return fmt.Errorf("seed fictional evaluation accounts: %w", err)
	}
	app, err := platform.New(db, platform.Options{})
	if err != nil {
		return fmt.Errorf("initialize shared HTTP handler: %w", err)
	}

	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64<<10), 32<<20)
	encoder := json.NewEncoder(os.Stdout)
	line := 0
	for scanner.Scan() {
		line++
		var input inputLine
		decoder := json.NewDecoder(bytes.NewReader(scanner.Bytes()))
		decoder.DisallowUnknownFields()
		if err = decoder.Decode(&input); err != nil {
			return fmt.Errorf("protocol line %d: %w", line, err)
		}
		var trailing any
		if err = decoder.Decode(&trailing); err != io.EOF {
			return fmt.Errorf("protocol line %d: expected exactly one JSON object", line)
		}
		var output any
		if input.Batch != nil {
			if len(input.Batch) < 2 || len(input.Batch) > 16 || input.Method != "" || input.Path != "" || len(input.Body) != 0 || len(input.Headers) != 0 {
				return fmt.Errorf("protocol line %d: batch requires 2-16 requests and no top-level request fields", line)
			}
			for _, request := range input.Batch {
				if err = validateRequest(request); err != nil {
					return fmt.Errorf("protocol line %d: %w", line, err)
				}
			}
			responses := make([]responseLine, len(input.Batch))
			start := make(chan struct{})
			var group sync.WaitGroup
			for index, request := range input.Batch {
				group.Add(1)
				go func(index int, request requestLine) {
					defer group.Done()
					<-start
					responses[index] = execute(app, request)
				}(index, request)
			}
			close(start)
			group.Wait()
			output = batchResponse{Responses: responses}
		} else {
			if err = validateRequest(input.requestLine); err != nil {
				return fmt.Errorf("protocol line %d: %w", line, err)
			}
			output = execute(app, input.requestLine)
		}
		if err = encoder.Encode(output); err != nil {
			return fmt.Errorf("write response for protocol line %d: %w", line, err)
		}
	}
	if err = scanner.Err(); err != nil {
		return fmt.Errorf("read protocol after line %d: %w", line, err)
	}
	return nil
}

func validateRequest(input requestLine) error {
	if input.Method == "" || !strings.HasPrefix(input.Path, "/") || strings.HasPrefix(input.Path, "//") {
		return fmt.Errorf("provide method and an absolute request path beginning with /")
	}
	return nil
}

func execute(app *platform.Server, input requestLine) responseLine {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	request := httptest.NewRequest(input.Method, "http://bridge.invalid"+input.Path, bytes.NewReader(input.Body)).WithContext(ctx)
	for name, value := range input.Headers {
		if strings.EqualFold(name, "Host") {
			request.Host = value
		} else {
			request.Header.Set(name, value)
		}
	}
	recorder := httptest.NewRecorder()
	app.ServeHTTP(recorder, request)
	response := recorder.Result()
	defer response.Body.Close()
	output := responseLine{Status: response.StatusCode, Headers: map[string]string{}, Body: recorder.Body.Bytes()}
	if output.Body == nil {
		output.Body = []byte{}
	}
	for name, values := range response.Header {
		output.Headers[name] = strings.Join(values, "\n")
	}
	return output
}
