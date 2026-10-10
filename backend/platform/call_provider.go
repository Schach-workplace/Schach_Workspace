package platform

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type liveKitClaims struct {
	Issuer    string         `json:"iss"`
	Subject   string         `json:"sub"`
	NotBefore int64          `json:"nbf"`
	Expires   int64          `json:"exp"`
	JWTID     string         `json:"jti"`
	Metadata  string         `json:"metadata"`
	Video     map[string]any `json:"video"`
}

func signCallToken(claims liveKitClaims, secret string) (string, error) {
	body, e := json.Marshal(claims)
	if e != nil {
		return "", e
	}
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	input := header + "." + base64.RawURLEncoding.EncodeToString(body)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(input))
	return input + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}
func parseCallToken(token, secret, issuer string) (liveKitClaims, error) {
	var claims liveKitClaims
	parts := strings.Split(token, ".")
	if len(parts) != 3 || len(token) > 10000 {
		return claims, denied()
	}
	signature, e := base64.RawURLEncoding.DecodeString(parts[2])
	if e != nil {
		return claims, denied()
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(parts[0] + "." + parts[1]))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return claims, denied()
	}
	header, e := base64.RawURLEncoding.DecodeString(parts[0])
	if e != nil {
		return claims, denied()
	}
	var algorithm struct {
		Algorithm string `json:"alg"`
	}
	if json.Unmarshal(header, &algorithm) != nil || algorithm.Algorithm != "HS256" {
		return claims, denied()
	}
	body, e := base64.RawURLEncoding.DecodeString(parts[1])
	if e != nil || json.Unmarshal(body, &claims) != nil || claims.Issuer != issuer || claims.Expires <= time.Now().Unix() || claims.NotBefore > time.Now().Unix() {
		return claims, denied()
	}
	return claims, nil
}
func (s *Server) liveKitAdmin(ctx context.Context, operation string, body any) error {
	target, e := url.Parse(s.opts.LiveKitURL)
	if e != nil {
		return e
	}
	target.Path = "/twirp/livekit.RoomService/" + operation
	grants := map[string]any{"room": body.(map[string]string)["room"]}
	switch operation {
	case "RemoveParticipant":
		grants["roomAdmin"] = true
	case "DeleteRoom":
		grants["roomCreate"] = true // Required by LiveKit; server-only, never a participant token.
	default:
		return errors.New("unsupported call provider operation")
	}
	token, e := signCallToken(liveKitClaims{Issuer: s.opts.LiveKitAPIKey, Subject: "schach-server", NotBefore: time.Now().Unix() - 1, Expires: time.Now().Unix() + 60, Video: grants}, s.opts.LiveKitAPISecret)
	if e != nil {
		return e
	}
	data, e := json.Marshal(body)
	if e != nil {
		return e
	}
	request, e := http.NewRequestWithContext(ctx, "POST", target.String(), strings.NewReader(string(data)))
	if e != nil {
		return e
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	response, e := (&http.Client{Timeout: 10 * time.Second}).Do(request)
	if e != nil {
		return e
	}
	defer response.Body.Close()
	if response.StatusCode == 404 {
		data, _ := io.ReadAll(io.LimitReader(response.Body, 8192))
		var failure struct {
			Code string `json:"code"`
		}
		if json.Unmarshal(data, &failure) == nil && failure.Code == "not_found" {
			return nil
		}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return errors.New("call provider operation failed")
	}
	return nil
}
