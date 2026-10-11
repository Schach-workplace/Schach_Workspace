package platform

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"regexp"
	"sync"
	"time"
	"unicode/utf8"
)

const credentialFormat = "people-credential-binding-v1"
const credentialIterations = 600000

var credentialKeyID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,40}$`)
var errCredentialWinner = errors.New("credential retry metadata changed")

type CredentialRetryBinding struct {
	Format     string
	Version    int
	KDF        string
	Iterations int
	OutputLen  int
	KeyID      string
	Salt       []byte
	Verifier   []byte
}

func credentialUnavailable() error {
	return &apiError{503, "credential_retry_unavailable", "Guided new-account onboarding is unavailable. Use manual People administration or ask the operator to configure credential retry keys.", nil}
}
func validateCredentialOptions(o *Options) error {
	if len(o.CredentialRetryKeys) == 0 && o.CredentialRetryActiveKeyID == "" {
		o.CredentialRetryKeys = nil
	} else {
		if len(o.CredentialRetryKeys) > 64 || !credentialKeyID.MatchString(o.CredentialRetryActiveKeyID) {
			return errors.New("invalid PEOPLE_CREDENTIAL_RETRY_ACTIVE_KEY_ID")
		}
		keys := make(map[string][]byte, len(o.CredentialRetryKeys))
		for id, key := range o.CredentialRetryKeys {
			if !credentialKeyID.MatchString(id) || len(key) != 32 {
				return errors.New("invalid PEOPLE_CREDENTIAL_RETRY_KEYS_JSON")
			}
			keys[id] = bytes.Clone(key)
		}
		if len(keys[o.CredentialRetryActiveKeyID]) != 32 {
			return errors.New("invalid PEOPLE_CREDENTIAL_RETRY_ACTIVE_KEY_ID")
		}
		o.CredentialRetryKeys = keys
	}
	if o.CredentialRetryActorCompanyLimit == 0 {
		o.CredentialRetryActorCompanyLimit = 120
	}
	if o.CredentialRetryActorLimit == 0 {
		o.CredentialRetryActorLimit = 300
	}
	if o.CredentialRetryMismatchLimit == 0 {
		o.CredentialRetryMismatchLimit = 20
	}
	if o.CredentialRetryConcurrent == 0 {
		o.CredentialRetryConcurrent = 2
	}
	if o.CredentialRetryWaiting == 0 {
		o.CredentialRetryWaiting = 8
	}
	if o.CredentialRetryQueueWait == 0 {
		o.CredentialRetryQueueWait = 5 * time.Second
	}
	if o.CredentialRetryActorCompanyLimit < 1 || o.CredentialRetryActorCompanyLimit > 100000 || o.CredentialRetryActorLimit < o.CredentialRetryActorCompanyLimit || o.CredentialRetryActorLimit > 100000 || o.CredentialRetryMismatchLimit < 1 || o.CredentialRetryMismatchLimit > 1000 || o.CredentialRetryConcurrent < 1 || o.CredentialRetryConcurrent > 32 || o.CredentialRetryWaiting < 1 || o.CredentialRetryWaiting > 256 || o.CredentialRetryQueueWait < time.Millisecond || o.CredentialRetryQueueWait > time.Minute {
		return errors.New("invalid credential retry admission bounds")
	}
	return nil
}

// Shared by standalone and Encore. All diagnostics contain field names only.
func ConfigurePeopleCredentialRetry(o *Options) error {
	active, raw := os.Getenv("PEOPLE_CREDENTIAL_RETRY_ACTIVE_KEY_ID"), os.Getenv("PEOPLE_CREDENTIAL_RETRY_KEYS_JSON")
	if active == "" && raw == "" {
		return validateCredentialOptions(o)
	}
	if len(raw) > 64<<10 || raw == "" || active == "" {
		return errors.New("invalid PEOPLE_CREDENTIAL_RETRY_KEYS_JSON or PEOPLE_CREDENTIAL_RETRY_ACTIVE_KEY_ID")
	}
	d := json.NewDecoder(bytes.NewBufferString(raw))
	token, e := d.Token()
	if e != nil || token != json.Delim('{') {
		return errors.New("invalid PEOPLE_CREDENTIAL_RETRY_KEYS_JSON")
	}
	keys := map[string][]byte{}
	for d.More() {
		token, e = d.Token()
		if e != nil {
			return errors.New("invalid PEOPLE_CREDENTIAL_RETRY_KEYS_JSON")
		}
		id, ok := token.(string)
		if !ok || !credentialKeyID.MatchString(id) || len(keys) >= 64 {
			return errors.New("invalid PEOPLE_CREDENTIAL_RETRY_KEYS_JSON")
		}
		if _, exists := keys[id]; exists {
			return errors.New("invalid PEOPLE_CREDENTIAL_RETRY_KEYS_JSON")
		}
		var encoded string
		if d.Decode(&encoded) != nil || len(encoded) != 64 {
			return errors.New("invalid PEOPLE_CREDENTIAL_RETRY_KEYS_JSON")
		}
		key, e := hex.DecodeString(encoded)
		if e != nil {
			return errors.New("invalid PEOPLE_CREDENTIAL_RETRY_KEYS_JSON")
		}
		keys[id] = key
	}
	if token, e = d.Token(); e != nil || token != json.Delim('}') {
		return errors.New("invalid PEOPLE_CREDENTIAL_RETRY_KEYS_JSON")
	}
	if _, e = d.Token(); e != io.EOF {
		return errors.New("invalid PEOPLE_CREDENTIAL_RETRY_KEYS_JSON")
	}
	o.CredentialRetryActiveKeyID = active
	o.CredentialRetryKeys = keys
	return validateCredentialOptions(o)
}
func credentialU64(n uint64) []byte { b := make([]byte, 8); binary.BigEndian.PutUint64(b, n); return b }
func credentialLP(parts ...[]byte) []byte {
	var b bytes.Buffer
	for _, part := range parts {
		b.Write(credentialU64(uint64(len(part))))
		b.Write(part)
	}
	return b.Bytes()
}
func newCredentialBinding(o Options) (*CredentialRetryBinding, error) {
	if len(o.CredentialRetryKeys[o.CredentialRetryActiveKeyID]) != 32 {
		return nil, credentialUnavailable()
	}
	salt := make([]byte, 24)
	if _, e := rand.Read(salt); e != nil {
		return nil, e
	}
	return &CredentialRetryBinding{Format: credentialFormat, Version: 1, KDF: "pbkdf2-sha256", Iterations: credentialIterations, OutputLen: 32, KeyID: o.CredentialRetryActiveKeyID, Salt: salt}, nil
}
func validateCredentialBinding(o Options, b *CredentialRetryBinding, stored bool) error {
	if b == nil || b.Format != credentialFormat || b.Version != 1 || b.KDF != "pbkdf2-sha256" || b.Iterations != credentialIterations || b.Iterations < passwordIterations || b.OutputLen != 32 || len(b.Salt) != 24 || !credentialKeyID.MatchString(b.KeyID) || stored && len(b.Verifier) != 32 {
		return credentialUnavailable()
	}
	if len(o.CredentialRetryKeys[b.KeyID]) != 32 {
		return credentialUnavailable()
	}
	return nil
}
func deriveCredential(o Options, b *CredentialRetryBinding, cid, actor, key string, canonical []byte, password string) ([]byte, error) {
	if e := validateCredentialBinding(o, b, false); e != nil {
		return nil, e
	}
	identity := credentialLP([]byte(cid), []byte(actor), []byte("onboarding_apply"), []byte(key))
	salt := credentialLP([]byte("schach/people/credential-retry/kdf-salt/v1"), b.Salt, identity)
	derived, e := pbkdf2.Key(sha256.New, password, salt, credentialIterations, 32)
	if e != nil {
		return nil, e
	}
	defer clear(derived)
	transcript := credentialLP([]byte("schach/people/credential-retry/mac/v1"), []byte(credentialFormat), []byte("pbkdf2-sha256"), credentialU64(600000), credentialU64(32), []byte(b.KeyID), b.Salt, identity, canonical, []byte{1}, derived)
	defer clear(transcript)
	mac := hmac.New(sha256.New, o.CredentialRetryKeys[b.KeyID])
	mac.Write(transcript)
	return mac.Sum(nil), nil
}
func sameCredentialMetadata(a, b *CredentialRetryBinding) bool {
	return a != nil && b != nil && a.Format == b.Format && a.Version == b.Version && a.KDF == b.KDF && a.Iterations == b.Iterations && a.OutputLen == b.OutputLen && a.KeyID == b.KeyID && bytes.Equal(a.Salt, b.Salt)
}

type credentialAdmission struct {
	mu              sync.Mutex
	timestamps      map[string][]time.Time
	active, waiting chan struct{}
}

func newCredentialAdmission(o Options) *credentialAdmission {
	return &credentialAdmission{timestamps: map[string][]time.Time{}, active: make(chan struct{}, o.CredentialRetryConcurrent), waiting: make(chan struct{}, o.CredentialRetryWaiting)}
}
func credentialRateLimit() error {
	return &apiError{429, "credential_retry_limited", "Credential onboarding is busy. Retry this same submitted request shortly.", nil}
}
func (a *credentialAdmission) charge(o Options, cid, actor string, mismatch bool) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-15 * time.Minute)
	for key, times := range a.timestamps {
		n := 0
		for n < len(times) && times[n].Before(cutoff) {
			n++
		}
		if n == len(times) {
			delete(a.timestamps, key)
		} else {
			a.timestamps[key] = times[n:]
		}
	}
	actorKey := "actor:" + actor
	companyKey := "company:" + actor + ":" + cid
	mismatchKey := "mismatch:" + actor + ":" + cid
	if len(a.timestamps) >= 5000 {
		return credentialRateLimit()
	}
	if mismatch {
		a.timestamps[mismatchKey] = append(a.timestamps[mismatchKey], now)
		return nil
	}
	if len(a.timestamps[actorKey]) >= o.CredentialRetryActorLimit || len(a.timestamps[companyKey]) >= o.CredentialRetryActorCompanyLimit || len(a.timestamps[mismatchKey]) >= o.CredentialRetryMismatchLimit {
		return credentialRateLimit()
	}
	a.timestamps[actorKey] = append(a.timestamps[actorKey], now)
	a.timestamps[companyKey] = append(a.timestamps[companyKey], now)
	return nil
}
func (a *credentialAdmission) run(ctx context.Context, wait time.Duration, fn func() error) error {
	if e := ctx.Err(); e != nil {
		return e
	}
	select {
	case a.active <- struct{}{}:
		defer func() { <-a.active }()
		return fn()
	default:
	}
	select {
	case a.waiting <- struct{}{}:
	default:
		return credentialRateLimit()
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case a.active <- struct{}{}:
		<-a.waiting
		defer func() { <-a.active }()
		if e := ctx.Err(); e != nil {
			return e
		}
		return fn()
	case <-timer.C:
		<-a.waiting
		return credentialRateLimit()
	case <-ctx.Done():
		<-a.waiting
		return ctx.Err()
	}
}

// encoding/json replaces malformed UTF-8 and lone surrogates. Reject both before
// decoding so password binding always denotes exact valid decoded UTF-8.
func validCredentialJSON(raw []byte) bool {
	if !utf8.Valid(raw) {
		return false
	}
	for i := 0; i < len(raw); i++ {
		if raw[i] != '\\' {
			continue
		}
		i++
		if i >= len(raw) {
			return false
		}
		if raw[i] != 'u' {
			continue
		}
		if i+4 >= len(raw) {
			return false
		}
		v, e := hex.DecodeString(string(raw[i+1 : i+5]))
		if e != nil {
			return false
		}
		n := binary.BigEndian.Uint16(v)
		i += 4
		if n >= 0xDC00 && n <= 0xDFFF {
			return false
		}
		if n >= 0xD800 && n <= 0xDBFF {
			if i+6 >= len(raw) || raw[i+1] != '\\' || raw[i+2] != 'u' {
				return false
			}
			v, e = hex.DecodeString(string(raw[i+3 : i+7]))
			if e != nil {
				return false
			}
			n = binary.BigEndian.Uint16(v)
			if n < 0xDC00 || n > 0xDFFF {
				return false
			}
			i += 6
		}
	}
	return true
}
func decodeCredentialRequest(w http.ResponseWriter, r *http.Request, dst any) error {
	raw, e := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if e != nil || !validCredentialJSON(raw) {
		return invalid("Use a bounded valid UTF-8 JSON request.")
	}
	defer clear(raw)
	return strictJSON(raw, dst)
}
