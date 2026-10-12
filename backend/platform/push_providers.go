package platform

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

type NativePushProviders struct {
	FCMProject   string
	FCMToken     oauth2.TokenSource
	APNSKey      *ecdsa.PrivateKey
	APNSKeyID    string
	APNSTeamID   string
	APNSBundleID string
	APNSSandbox  bool
	client       *http.Client
}

func nativePushFromEnvironment() (PushSender, error) {
	p := &NativePushProviders{client: &http.Client{Timeout: 10 * time.Second}}
	if file := os.Getenv("FCM_SERVICE_ACCOUNT_FILE"); file != "" {
		data, e := os.ReadFile(file)
		if e != nil {
			return nil, e
		}
		var account struct {
			ProjectID string `json:"project_id"`
			TokenURI  string `json:"token_uri"`
		}
		if e := json.Unmarshal(data, &account); e != nil {
			return nil, e
		}
		if !regexp.MustCompile(`^[a-z][a-z0-9-]{4,62}$`).MatchString(account.ProjectID) || account.TokenURI != "https://oauth2.googleapis.com/token" {
			return nil, errors.New("FCM requires a project service account and Google's HTTPS token endpoint")
		}
		config, e := google.JWTConfigFromJSON(data, "https://www.googleapis.com/auth/firebase.messaging")
		if e != nil {
			return nil, e
		}
		p.FCMProject = account.ProjectID
		p.FCMToken = config.TokenSource(context.WithValue(context.Background(), oauth2.HTTPClient, p.client))
	}
	if file := os.Getenv("APNS_AUTH_KEY_FILE"); file != "" {
		data, e := os.ReadFile(file)
		if e != nil {
			return nil, e
		}
		block, _ := pem.Decode(data)
		if block == nil {
			return nil, errors.New("APNs requires a PEM token-signing key")
		}
		key, e := x509.ParsePKCS8PrivateKey(block.Bytes)
		if e != nil {
			return nil, e
		}
		var ok bool
		p.APNSKey, ok = key.(*ecdsa.PrivateKey)
		if !ok || p.APNSKey.Curve != elliptic.P256() {
			return nil, errors.New("APNs requires an ES256 token-signing key")
		}
		p.APNSKeyID = os.Getenv("APNS_KEY_ID")
		p.APNSTeamID = os.Getenv("APNS_TEAM_ID")
		p.APNSBundleID = os.Getenv("APNS_BUNDLE_ID")
		p.APNSSandbox = os.Getenv("APNS_SANDBOX") == "true"
		if !clean(p.APNSKeyID, 64) || !clean(p.APNSTeamID, 64) || !clean(p.APNSBundleID, 200) {
			return nil, errors.New("APNs key, team and native bundle identifiers are required")
		}
	}
	if p.FCMToken == nil && p.APNSKey == nil {
		return nil, nil
	}
	return p, nil
}

// nativePushData is the complete provider-visible custom data: opaque ids only,
// never titles, bodies, amounts, names, item types or source/target ids.
func nativePushData(hint PushHint) (map[string]string, string) {
	if hint.AttentionID != "" {
		return map[string]string{"eventId": hint.EventID, "companyId": hint.CompanyID, "attentionId": hint.AttentionID}, hint.AttentionID
	}
	return map[string]string{"eventId": hint.EventID, "companyId": hint.CompanyID, "conversationId": hint.ConversationID}, hint.ConversationID
}
func (p *NativePushProviders) Send(ctx context.Context, device CommunicationDevice, hint PushHint) error {
	data, collapse := nativePushData(hint)
	var target, bearer string
	var payload any
	headers := map[string]string{}
	switch device.PushProvider {
	case "fcm":
		if p.FCMToken == nil {
			return errors.New("FCM delivery is not configured")
		}
		token, e := p.FCMToken.Token()
		if e != nil {
			return errors.New("FCM authorization unavailable")
		}
		bearer = token.AccessToken
		target = "https://fcm.googleapis.com/v1/projects/" + p.FCMProject + "/messages:send"
		payload = map[string]any{"message": map[string]any{"token": device.PushToken, "notification": map[string]string{"title": "Schach Workspace", "body": "A company update is available."}, "data": data, "android": map[string]any{"collapse_key": collapse, "ttl": "60s", "notification": map[string]string{"channel_id": "schach-updates"}}}}
	case "apns":
		if p.APNSKey == nil {
			return errors.New("APNs delivery is not configured")
		}
		if _, e := hex.DecodeString(device.PushToken); e != nil || len(device.PushToken) != 64 {
			return ErrPushDeviceGone
		}
		header, _ := json.Marshal(map[string]string{"alg": "ES256", "kid": p.APNSKeyID})
		body, _ := json.Marshal(map[string]any{"iss": p.APNSTeamID, "iat": time.Now().Unix()})
		input := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(body)
		hash := sha256.Sum256([]byte(input))
		r, s, e := ecdsa.Sign(rand.Reader, p.APNSKey, hash[:])
		if e != nil {
			return e
		}
		signature := make([]byte, 64)
		r.FillBytes(signature[:32])
		s.FillBytes(signature[32:])
		bearer = input + "." + base64.RawURLEncoding.EncodeToString(signature)
		host := "https://api.push.apple.com"
		if p.APNSSandbox {
			host = "https://api.sandbox.push.apple.com"
		}
		target = host + "/3/device/" + device.PushToken
		apns := map[string]any{"aps": map[string]any{"alert": map[string]string{"title": "Schach Workspace", "body": "A company update is available."}}}
		for k, v := range data {
			apns[k] = v
		}
		payload = apns
		headers["apns-topic"] = p.APNSBundleID
		headers["apns-push-type"] = "alert"
		headers["apns-priority"] = "10"
		headers["apns-expiration"] = fmt.Sprint(time.Now().Unix() + 60)
		headers["apns-collapse-id"] = collapse
	default:
		return ErrPushDeviceGone
	}
	body, e := json.Marshal(payload)
	if e != nil {
		return e
	}
	request, e := http.NewRequestWithContext(ctx, "POST", target, bytes.NewReader(body))
	if e != nil {
		return e
	}
	request.Header.Set("Authorization", "Bearer "+bearer)
	request.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		request.Header.Set(k, v)
	}
	response, e := p.client.Do(request)
	if e != nil {
		return errors.New("native push transport unavailable")
	}
	defer response.Body.Close()
	body, _ = io.ReadAll(io.LimitReader(response.Body, 8192))
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return nil
	}
	if device.PushProvider == "apns" {
		var failure struct {
			Reason string `json:"reason"`
		}
		if json.Unmarshal(body, &failure) == nil && in(failure.Reason, "BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic") {
			return ErrPushDeviceGone
		}
	} else if strings.Contains(string(body), `"UNREGISTERED"`) {
		return ErrPushDeviceGone
	}
	return errors.New("native push provider rejected the hint")
}
