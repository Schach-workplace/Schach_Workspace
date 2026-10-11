package platform

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"
)

func TestOnboardingCredentialBindingReference(t *testing.T) {
	raw, e := os.ReadFile("../../verification/workspace-improvements-roadmap/milestone-9-credential-reference.json")
	if e != nil {
		t.Fatal(e)
	}
	var v struct {
		IdentityFields                                                                                           []string
		CanonicalBusinessUTF8, PasswordUTF8, RandomSaltHex, FictionalKeyID, FictionalKeyHex, ExpectedVerifierHex string
	}
	if e = json.Unmarshal(raw, &v); e != nil {
		t.Fatal(e)
	}
	salt, _ := hex.DecodeString(v.RandomSaltHex)
	key, _ := hex.DecodeString(v.FictionalKeyHex)
	expected, _ := hex.DecodeString(v.ExpectedVerifierHex)
	opts := Options{CredentialRetryActiveKeyID: v.FictionalKeyID, CredentialRetryKeys: map[string][]byte{v.FictionalKeyID: key}}
	if e = validateCredentialOptions(&opts); e != nil {
		t.Fatal(e)
	}
	binding := &CredentialRetryBinding{Format: credentialFormat, Version: 1, KDF: "pbkdf2-sha256", Iterations: 600000, OutputLen: 32, KeyID: v.FictionalKeyID, Salt: salt}
	got, e := deriveCredential(opts, binding, v.IdentityFields[0], v.IdentityFields[1], v.IdentityFields[3], []byte(v.CanonicalBusinessUTF8), v.PasswordUTF8)
	if e != nil || !bytes.Equal(got, expected) {
		t.Fatal("independent LP/U64/KDF/HMAC reference mismatch")
	}
	binding.Verifier = got
	binding.Iterations = 1
	if validateCredentialBinding(opts, binding, true) == nil {
		t.Fatal("downgrade accepted")
	}
	binding.Iterations = 600000
	binding.KeyID = "missing"
	if validateCredentialBinding(opts, binding, true) == nil {
		t.Fatal("missing retained key accepted")
	}
}
func TestOnboardingCredentialEncodingAndConfig(t *testing.T) {
	for _, raw := range []string{`{"password":"\ud800"}`, `{"password":"\udc00"}`, string([]byte{'"', 0xff, '"'})} {
		if validCredentialJSON([]byte(raw)) {
			t.Fatal("malformed credential encoding accepted")
		}
	}
	for _, raw := range []string{`{"password":"\ud83d\ude00"}`, `{"password":"literal\\ud800"}`, `{"password":" exact üTF8 "}`} {
		if !validCredentialJSON([]byte(raw)) {
			t.Fatal("valid exact encoding rejected")
		}
	}
	t.Setenv("PEOPLE_CREDENTIAL_RETRY_ACTIVE_KEY_ID", "fixture")
	t.Setenv("PEOPLE_CREDENTIAL_RETRY_KEYS_JSON", `{"fixture":"202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f","fixture":"202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f"}`)
	if ConfigurePeopleCredentialRetry(&Options{}) == nil {
		t.Fatal("duplicate key ID accepted")
	}
}

func TestOnboardingCredentialAdmissionCancelledBeforeWork(t *testing.T) {
	opts := Options{}
	if e := validateCredentialOptions(&opts); e != nil {
		t.Fatal(e)
	}
	a := newCredentialAdmission(opts)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	err := a.run(ctx, time.Second, func() error { called = true; return nil })
	if called || !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled request consumed credential CPU")
	}
}
func TestOnboardingCredentialAdmissionBounds(t *testing.T) {
	opts := Options{}
	if e := validateCredentialOptions(&opts); e != nil {
		t.Fatal(e)
	}
	a := newCredentialAdmission(opts)
	for i := 0; i < 30; i++ {
		if e := a.charge(opts, "batch-company", "administrator", false); e != nil {
			t.Fatalf("ordinary 30-person batch denied at %d", i)
		}
	}
	for i := 0; i < 20; i++ {
		if e := a.charge(opts, "batch-company", "administrator", true); e != nil {
			t.Fatal(e)
		}
	}
	if e := a.charge(opts, "batch-company", "administrator", false); e == nil {
		t.Fatal("proven mismatch bound ignored")
	}
	if e := a.charge(opts, "other-company", "administrator", false); e != nil {
		t.Fatal("company mismatch quota leaked into independent company")
	}
}

func TestOnboardingCredentialAdmissionQueue(t *testing.T) {
	opts := Options{}
	if e := validateCredentialOptions(&opts); e != nil {
		t.Fatal(e)
	}
	a := newCredentialAdmission(opts)
	for i := 0; i < 2; i++ {
		a.active <- struct{}{}
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 8)
	for i := 0; i < 8; i++ {
		go func() {
			done <- a.run(ctx, 5*time.Second, func() error { t.Error("cancelled queued work ran"); return nil })
		}()
	}
	deadline := time.Now().Add(time.Second)
	for len(a.waiting) != 8 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if len(a.waiting) != 8 {
		t.Fatal("bounded waiting queue did not fill")
	}
	if e := a.run(context.Background(), time.Second, func() error { t.Error("overflow work ran"); return nil }); e == nil {
		t.Fatal("overflow request admitted")
	}
	cancel()
	for i := 0; i < 8; i++ {
		if e := <-done; !errors.Is(e, context.Canceled) {
			t.Fatal("queued cancellation changed")
		}
	}
	if len(a.waiting) != 0 || len(a.active) != 2 {
		t.Fatal("admission slot leak")
	}
	<-a.active
	<-a.active
	a.active <- struct{}{}
	a.active <- struct{}{}
	if e := a.run(context.Background(), 10*time.Millisecond, func() error { t.Error("timed out work ran"); return nil }); e == nil {
		t.Fatal("queue timeout ignored")
	}
	if len(a.waiting) != 0 {
		t.Fatal("timeout slot leak")
	}
}
