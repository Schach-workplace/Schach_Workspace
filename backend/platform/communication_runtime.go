package platform

import (
	"context"
	"encoding/hex"
	"log/slog"
	"net/url"
	"os"
	"strconv"
	"time"
)

func ConfigureCommunication(options *Options) error {
	for name, target := range map[string]*int64{"COMMUNICATION_MEDIA_LIMIT_BYTES": &options.MediaLimitBytes, "COMMUNICATION_USER_QUOTA_BYTES": &options.MediaUserQuotaBytes, "COMMUNICATION_COMPANY_QUOTA_BYTES": &options.MediaCompanyQuotaBytes} {
		if raw := os.Getenv(name); raw != "" {
			n, e := strconv.ParseInt(raw, 10, 64)
			if e != nil || n < 1 {
				return invalid(name + " must be a positive integer")
			}
			*target = n
		}
	}
	for name, target := range map[string]*int{"COMMUNICATION_MEDIA_RETENTION_DAYS": &options.MediaRetentionDays, "COMMUNICATION_UNUSED_UPLOAD_HOURS": &options.UnusedUploadHours, "COMMUNICATION_MESSAGE_RETENTION_DAYS": &options.MessageRetentionDays} {
		if raw := os.Getenv(name); raw != "" {
			n, e := strconv.Atoi(raw)
			if e != nil || n < 1 {
				return invalid(name + " must be a positive integer")
			}
			*target = n
		}
	}
	if key := os.Getenv("MFA_ENCRYPTION_KEY"); key != "" {
		b, e := hex.DecodeString(key)
		if e != nil || len(b) != 32 {
			return invalid("MFA_ENCRYPTION_KEY must contain a 32-byte hexadecimal encryption key.")
		}
		options.MFAEncryptionKey = b
	}
	if root := os.Getenv("MEDIA_ROOT"); root != "" {
		store, e := NewFileMediaStore(root)
		if e != nil {
			return e
		}
		options.MediaStore = store
	}
	if address := os.Getenv("CLAMAV_ADDRESS"); address != "" {
		options.MediaScanner = ClamAVScanner{Address: address}
	}
	options.LiveKitURL = os.Getenv("LIVEKIT_INTERNAL_URL")
	options.LiveKitAPIKey = os.Getenv("LIVEKIT_API_KEY")
	options.LiveKitAPISecret = os.Getenv("LIVEKIT_API_SECRET")
	if options.LiveKitURL != "" {
		u, e := url.Parse(options.LiveKitURL)
		if e != nil || u.Host == "" || !in(u.Scheme, "http", "https") || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || options.LiveKitAPIKey == "" || len(options.LiveKitAPISecret) < 32 {
			return invalid("Configure a private LiveKit signaling URL, API key and secret of at least 32 characters.")
		}
	}
	push, e := nativePushFromEnvironment()
	if e != nil {
		return e
	}
	options.PushSender = push
	return nil
}
func (s *Server) RunCommunicationWorker(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	scan := 0
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			bounded, cancel := context.WithTimeout(ctx, 30*time.Second)
			_, e := s.RunCommunicationOutbox(bounded, 100)
			if e != nil && ctx.Err() == nil {
				slog.Error("communication outbox unavailable")
			}
			if _, e = s.RunCallRevocations(bounded); e != nil && ctx.Err() == nil {
				slog.Error("call revocation unavailable")
			}
			if _, e = s.RunMissedCalls(bounded, time.Now().UTC()); e != nil && ctx.Err() == nil {
				slog.Error("call outcomes unavailable")
			}
			if _, e = s.RunCallCleanup(bounded); e != nil && ctx.Err() == nil {
				slog.Error("call cleanup unavailable")
			}
			if _, e = s.RunCommunicationPush(bounded, time.Now().UTC()); e != nil && ctx.Err() == nil {
				slog.Error("communication push unavailable")
			}
			scan++
			if scan%60 == 0 {
				if _, e = s.RunAttention(bounded, time.Now().UTC(), 100); e != nil && ctx.Err() == nil {
					slog.Error("local attention unavailable")
				}
				if _, e = s.RunMessageRetention(bounded); e != nil && ctx.Err() == nil {
					slog.Error("communication retention unavailable")
				}
				_, e = s.RunMediaCleanup(bounded)
				if e != nil && ctx.Err() == nil {
					slog.Error("communication media cleanup unavailable")
				}
			}
			cancel()
		}
	}
}
