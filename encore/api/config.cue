package api

// Set real deployment origins and bootstrap identity before a production build.
// Passwords are supplied through Encore secrets, never committed here.
AllowedOrigins: [...string] | *["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4000", "http://127.0.0.1:4000"]
SecureCookies: bool | *true
SessionHours: 72
SeedDemo: false
BootstrapEmail: ""
BootstrapName: "Founder"

if #Meta.Environment.Type == "development" && #Meta.Environment.Cloud == "local" {
 SecureCookies: false
}
if #Meta.Environment.Type == "test" {
 SecureCookies: false
}
