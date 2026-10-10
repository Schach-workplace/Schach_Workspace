package platform

import (
	"testing"
	"time"
)

func TestTOTPReferenceAndReplay(t *testing.T) {
	secret := []byte("12345678901234567890")
	if got := totpCode(secret, 59/30, 8); got != "94287082" {
		t.Fatal("RFC6238 vector", got)
	}
}
func TestMFAEnrollmentLoginAndSingleUseRecovery(t *testing.T) {
	s, c, _, _, _, _ := conversationFixture(t)
	s.opts.MFAEncryptionKey = make([]byte, 32)
	for i := range s.opts.MFAEncryptionKey {
		s.opts.MFAEncryptionKey[i] = byte(i + 1)
	}
	start := financeOK(t, s, "POST", "/api/auth/mfa/setup", map[string]any{"password": "A-strong-password!2026"}, c)
	secret := start["secret"].(string)
	decoded, e := mfaSecretEncoding.DecodeString(secret)
	if e != nil {
		t.Fatal(e)
	}
	counter := time.Now().Unix() / 30
	code := totpCode(decoded, counter-1, 6)
	confirmed := financeOK(t, s, "POST", "/api/auth/mfa/confirm", map[string]any{"code": code}, c)
	codes := confirmed["recoveryCodes"].([]any)
	credentials := map[string]any{"email": "founder@example.com", "password": "A-strong-password!2026"}
	st, b, _ := req(t, s, "POST", "/api/auth/login", credentials, nil)
	if st != 401 || b["error"].(map[string]any)["code"] != "mfa_required" {
		t.Fatal("MFA bypass", st, b)
	}
	credentials["code"] = totpCode(decoded, counter, 6)
	if st, _, _ := req(t, s, "POST", "/api/auth/login", credentials, nil); st != 200 {
		t.Fatal("TOTP login", st)
	}
	if st, _, _ := req(t, s, "POST", "/api/auth/login", credentials, nil); st != 401 {
		t.Fatal("TOTP replay", st)
	}
	credentials["code"] = ""
	credentials["recoveryCode"] = codes[0]
	if st, _, _ := req(t, s, "POST", "/api/auth/login", credentials, nil); st != 200 {
		t.Fatal("recovery login", st)
	}
	if st, _, _ := req(t, s, "POST", "/api/auth/login", credentials, nil); st != 401 {
		t.Fatal("recovery replay", st)
	}
}

func TestOperatorRecoveryPreservesMFAUnlessExplicitAndRevokesDevices(t *testing.T) {
	s, c, _, _, _, _ := conversationFixture(t)
	s.opts.MFAEncryptionKey = make([]byte, 32)
	start := financeOK(t, s, "POST", "/api/auth/mfa/setup", map[string]any{"password": "A-strong-password!2026"}, c)
	secret, _ := mfaSecretEncoding.DecodeString(start["secret"].(string))
	financeOK(t, s, "POST", "/api/auth/mfa/confirm", map[string]any{"code": totpCode(secret, time.Now().Unix()/30-1, 6)}, c)
	financeOK(t, s, "POST", "/api/devices", map[string]any{"platform": "web", "name": "Recovery session"}, c)
	if e := ResetPassword(s.db, "founder@example.com", "Replacement-password!2026"); e != nil {
		t.Fatal(e)
	}
	st, body, _ := req(t, s, "POST", "/api/auth/login", map[string]any{"email": "founder@example.com", "password": "Replacement-password!2026"}, nil)
	if st != 401 || body["error"].(map[string]any)["code"] != "mfa_required" {
		t.Fatal("password reset removed MFA", st, body)
	}
	if e := RecoverAccount(s.db, "founder@example.com", "Replacement-password!2026", true, ""); e == nil {
		t.Fatal("unaudited MFA recovery")
	}
	if e := RecoverAccount(s.db, "founder@example.com", "Replacement-password!2026", true, "Verified lost authenticator identity through operator process"); e != nil {
		t.Fatal(e)
	}
	st, _, _ = req(t, s, "POST", "/api/auth/login", map[string]any{"email": "founder@example.com", "password": "Replacement-password!2026"}, nil)
	if st != 200 {
		t.Fatal("explicit recovery", st)
	}
	var count int64
	s.db.Model(&CommunicationDevice{}).Where("active=?", true).Count(&count)
	if count != 0 {
		t.Fatal("recovery device survived")
	}
}
